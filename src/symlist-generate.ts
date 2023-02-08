#!/usr/bin/env node

import {ArgumentParser} from "argparse";

import fs, {promises} from "fs";
import path from "path";
import {dumpSymbols, LibInfo, listNeeded} from "./utils";
import {readFile} from "fs/promises";

interface Args {
    input: string;
    output: string;
}


async function getSystemVersion(input: string): Promise<string> {
    const issue = (await readFile(path.join(input, 'rootfs.pak.unsquashfs', 'etc', 'starfish-release'))).toString('utf-8');
    const match = /release (\d+\.\d+\.\d+)/.exec(issue);
    if (!match) throw Error('Failed to read firmware file system');
    return match[1];
}

async function getLdLibPaths(input: string): Promise<string[]> {
    return (await readFile(path.join(input, 'rootfs.pak.unsquashfs', 'etc', 'ld.so.conf'), {encoding: 'utf-8'}))
        .split('\n')
        .filter(l => l)
        .map(l => l.trim());
}

async function main(args: Args) {
    const version = await getSystemVersion(args.input);
    if (!version) {
        console.warn('Can\'t infer system version')
        return;
    }
    console.log(`Extracting symbols list for webOS ${version}`);

    const parts = (await promises.readdir(args.input)).filter(n => n.endsWith('.unsquashfs'));
    const libpaths = ['/lib', '/usr/lib', ...await getLdLibPaths(args.input)].map(p => {
        if (p.startsWith('/mnt/bsppart/')) {
            return path.join(parts.find(v => v.startsWith('bsppart'))!, p.substring(13));
        }
        return path.join(parts.find(v => v.startsWith('rootfs'))!, p.substring(1));
    });

    const libs: { [key: string]: LibInfo } = {};
    const index: { [key: string]: string } = {};

    function resolveLink(dir: string, name: string) {
        let link = path.resolve(dir, fs.readlinkSync(path.posix.join(dir, name)));
        while (fs.lstatSync(link).isSymbolicLink()) {
            link = path.resolve(dir, fs.readlinkSync(link));
        }
        return link;
    }

    for (let libpath of libpaths) {
        const dir = path.posix.join(args.input, libpath);
        if (!fs.existsSync(dir)) {
            console.warn(`${dir} not found.`);
            continue;
        }
        for (let file of fs.readdirSync(dir, {withFileTypes: true})) {
            let item: LibInfo | null = null;
            if (!file.name.includes('.so')) continue;
            if (file.isFile()) {
                item = libs[file.name] || {};
                try {
                    item.symbols = await dumpSymbols(path.posix.join(dir, file.name));
                    item.needed = await listNeeded(path.posix.join(dir, file.name));
                } catch (e) {
                    console.warn(e);
                    continue;
                }
                libs[file.name] = item;
                index[file.name] = `${file.name}.json`;
            } else if (file.isSymbolicLink()) {
                let target;
                try {
                    target = resolveLink(dir, file.name);
                } catch (e) {
                    continue;
                }
                let targetName = path.posix.basename(target);
                item = libs[targetName] || {};
                libs[targetName] = item;
                index[file.name] = `${targetName}.json`;
            } else {
                continue;
            }
            item.names = item.names || [];
            item.names.push(file.name);
        }
    }

    const outdir = path.join(args.output, version);
    if (!fs.existsSync(outdir)) {
        fs.mkdirSync(outdir, {recursive: true});
    }
    fs.writeFileSync(path.join(outdir, 'index.json'), JSON.stringify(index, null, 2), {encoding: 'utf-8'});
    for (let name in libs) {
        let item = libs[name];
        if (!item.symbols) continue;
        fs.writeFileSync(path.join(outdir, `${name}.json`), JSON.stringify(item, null, 2), {encoding: 'utf-8'});
    }
}

const argparser = new ArgumentParser();
argparser.add_argument('-i', '--input', {
    type: String,
    required: true,
    help: 'Directory of extracted firmware'
});
argparser.add_argument('-o', '--output', {
    type: String,
    required: true
});

main(argparser.parse_args()).catch(e => console.error(e));
