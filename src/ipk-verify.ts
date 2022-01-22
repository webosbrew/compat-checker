#!/usr/bin/env node
import {ArgumentParser} from "argparse";

import {verifyElf} from "./utils";

import path from "path";
import {mkdir, mkdtemp, readdir, readFile, rm, symlink} from "fs/promises";

import ar from "ar";
import os from "os";
import Table from "cli-table";
import colors from "colors";
import {createWriteStream, existsSync} from "fs";
import tar, {Headers} from 'tar-stream';
import {gunzipSync} from "zlib";

const versions = require(path.join(__dirname, '../data/versions.json'));

interface Args {
    packages: string[];
    list: boolean;
    verbose: boolean;
}

async function extractIpk(tmp: string, pkg: string): Promise<string[]> {
    return await new Promise(async (resolve, reject) => {
        const archive = new ar.Archive(await readFile(pkg));

        for (let file of archive.getFiles()) {
            if (file.name() !== 'data.tar.gz') continue;
            const extract = tar.extract();
            const result: string[] = [];
            extract.on('entry', async (header: Headers, stream, next) => {
                const filepath = path.posix.resolve(tmp, header.name);
                if (path.posix.basename(header.name) === 'appinfo.json') {
                    result.push(path.posix.dirname(filepath));
                }
                stream.on('end', () => {
                    next();
                });
                switch (header.type) {
                    case 'directory':
                        await mkdir(filepath, {recursive: true});
                        if (args.verbose) {
                            console.log(`mkdir ${filepath}`);
                        }
                        break;
                    case 'file':
                        if (args.verbose) {
                            console.log(`write ${filepath}`);
                        }
                        stream.pipe(createWriteStream(filepath));
                        break;
                    case 'symlink':
                        if (!header.linkname) {
                            break;
                        }
                        const target = path.posix.resolve(path.posix.dirname(filepath), header.linkname);
                        if (args.verbose) {
                            console.log(`link ${filepath} => ${target}`);
                        }
                        await symlink(target, filepath);
                        break;
                }
                stream.resume();
            });
            extract.on('finish', () => {
                resolve(result);
            });
            extract.write(gunzipSync(file.fileData()), () => extract.end());
        }
    });
}

async function main(tmp: string, args: Args) {
    for (const pkg of args.packages) {
        console.log(`Extracting package ${path.basename(pkg)}...`);

        const appdirs: string[] = await extractIpk(tmp, pkg);

        for (const appdir of appdirs) {
            const appinfo = require(path.join(appdir, 'appinfo.json'));
            if (appinfo.type !== 'native') {
                console.log(`Skipping non-native app ${appinfo.id}`);
                continue;
            }
            console.log(`Checking app ${appinfo.id} ${appinfo.version}...`);
            const mainexe = path.join(appdir, appinfo.main);
            const table = new Table({head: ['', ...versions.map((version: string) => version.reset)]});

            const libdir = path.join(appdir, 'lib');

            async function verifyColumn(elf: string) {
                return await Promise.all(versions.map(async (version: string) => {
                    const result = await verifyElf(elf, [libdir], version)
                    switch (result.status) {
                        case 'ok':
                            return colors.green(result.status);
                        case 'warn':
                            return colors.yellow(result.status);
                        case 'fail':
                            return colors.bold.red(result.status);
                        default:
                            return result;
                    }
                }));
            }

            table.push({
                [`main: ${appinfo.main}`.reset]: await verifyColumn(mainexe)
            });

            if (existsSync(libdir)) {
                for (const lib of await readdir(libdir)) {
                    table.push({
                        [`lib: ${path.basename(lib)}`.reset]: await verifyColumn(path.join(libdir, lib))
                    });
                }
            }
            console.log(table.toString());
        }
    }
}

const argparser = new ArgumentParser();
argparser.add_argument('packages', {type: String, nargs: '+'});
argparser.add_argument('--list', '-l', {action: 'store_const', const: true, default: false});
argparser.add_argument('--verbose', '-v', {action: 'store_const', const: true, default: false});

const args: Args = argparser.parse_args();
mkdtemp(path.resolve(os.tmpdir(), 'webosbrew-compat-checker-')).then(async (tmp: string) => {
    await main(tmp, args).finally(() => rm(tmp, {recursive: true}));
});
