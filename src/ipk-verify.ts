#!/usr/bin/env node
import {ArgumentParser} from "argparse";

import {BinaryInfo, binInfo, verifyElf, VerifyResult, VerifyStatus} from "./utils";

import path from "path";
import {lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, symlink} from "fs/promises";

import ar from "ar";
import os from "os";
import Table from "cli-table";
import colors from "colors";
import {createWriteStream, existsSync, lstatSync} from "fs";
import tar, {Headers} from 'tar-stream';
import {gunzipSync} from "zlib";
import Dict = NodeJS.Dict;

const versions: string[] = require(path.join(__dirname, '../data/versions.json'));
const markdownChars = {
    'top': '', 'top-mid': '', 'top-left': '', 'top-right': '',
    'mid': '-', 'left-mid': '|', 'mid-mid': '|', 'right-mid': '|',
    'bottom': '', 'bottom-mid': '', 'bottom-left': '', 'bottom-right': '',
    'middle': '|', 'left': '|', 'right': '|'
};

interface Args {
    packages: string[];
    list: boolean;
    markdown: boolean;
    verbose: boolean;
}

interface IpkInfo {
    appdirs: string[];
    links: Dict<string>;
}

class LibsInfo {
    constructor(
        public readonly libs: BinaryInfo[],
        public readonly links: Dict<string>
    ) {
    }
}

async function extractIpk(tmp: string, pkg: string): Promise<IpkInfo> {
    return await new Promise(async (resolve, reject) => {
        const archive = new ar.Archive(await readFile(pkg));

        for (let file of archive.getFiles()) {
            if (file.name() !== 'data.tar.gz') continue;
            const extract = tar.extract();
            const result: string[] = [];
            const links: { [key: string]: string } = {};
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
                        links[filepath] = target;
                        break;
                }
                stream.resume();
            });
            extract.on('finish', () => {
                resolve({appdirs: result, links: links});
            });
            extract.write(gunzipSync(file.fileData()), () => extract.end());
        }
    });
}

async function readlinkr(p: string) {
    let tmp = p;
    while ((await lstat(tmp)).isSymbolicLink()) {
        tmp = path.resolve(path.dirname(tmp), await readlink(tmp));
    }
    return tmp;
}

async function listLibraries(libdir: string, mainbin: BinaryInfo): Promise<LibsInfo> {
    if (!existsSync(libdir)) return new LibsInfo([], {});
    const libs = await readdir(libdir);
    const libpaths = libs.map(lib => path.join(libdir, lib));
    const libstats = Object.assign({}, ...libpaths.map(libpath => ({[libpath]: lstatSync(libpath)})));
    const links = Object.assign({}, ...await Promise.all(libpaths.filter(p => libstats[p].isSymbolicLink()).map(async p => ({
        [path.basename(p)]: path.basename(await readlinkr(p))
    }))));
    return new LibsInfo(await Promise.all(libpaths
        .filter(p => !libstats[p].isSymbolicLink())
        .map(async p => await binInfo(p, 'lib', mainbin, links))), links);
}

function printTable(binaries: BinaryInfo[], libsInfo: LibsInfo, versionedResults: Dict<Dict<VerifyResult>>,
                    ipkinfo: IpkInfo, markdown: boolean) {
    function bold(s: string): string {
        if (markdown) {
            return colors.bold(`**${s}**`);
        }
        return colors.bold(s);
    }

    function applyStyle(status: VerifyStatus): string {
        switch (status) {
            case 'ok':
                return colors.green(status);
            case 'warn':
                return colors.yellow(status);
            case 'fail':
                return colors.red(bold(status));
            default:
                return status;
        }
    }


    const table = new Table({
        colors: false,
        style: {compact: markdown},
        chars: markdown ? markdownChars : {},
        head: ['', ...versions.map((version: string) => colors.reset(version))]
    });
    const mainbin = binaries.filter(bin => bin.type == 'main')[0]!!;
    const importantSym = markdown ? '\\*' : '*';
    for (const binary of binaries) {
        let name = `${binary.type}${binary.important ? importantSym : ''}: ${binary.name}`;
        const needed = mainbin.needed.map(name => libsInfo.links[name] || name);
        const important = binary.type == 'main' || needed.includes(binary.name);
        if (binary.important) {
            name = colors.reset(bold(name));
        } else {
            name = colors.reset(name);
        }
        table.push({
            [name]: versions.map(version => {
                const results = versionedResults[version]!!;
                const status = results[binary.name]!!.status(results, ipkinfo.links);
                if (important && status == 'fail') {
                    process.exitCode = 1;
                }
                return applyStyle(status);
            })
        })
    }

    console.log(table.toString());
    console.log(`  ${importantSym}: main executable or libraries directly linked to main executable`);
}

async function main(tmp: string, args: Args) {
    for (const pkg of args.packages) {
        console.log(`Extracting package ${path.basename(pkg)}...`);

        const ipkinfo: IpkInfo = await extractIpk(tmp, pkg);

        for (const appdir of ipkinfo.appdirs) {
            const appinfo = require(path.join(appdir, 'appinfo.json'));
            if (appinfo.type !== 'native') {
                console.log(`Skipping non-native app ${appinfo.id}`);
                continue;
            }
            console.log(`Checking app ${appinfo.id} ${appinfo.version}...`);
            const libdir = path.join(appdir, 'lib');

            const binaries: BinaryInfo[] = [];
            const mainBin = await binInfo(path.join(appdir, appinfo.main), 'main');
            binaries.push(mainBin);

            const libsInfo = await listLibraries(libdir, mainBin);
            binaries.push(...libsInfo.libs);

            async function verifyBinaries(binaries: BinaryInfo[], version: string): Promise<Dict<VerifyResult>> {
                return Object.assign({}, ...await Promise.all(binaries.map(async binary => {
                    const verify = await verifyElf(binary, [libdir], version);
                    return {[binary.name]: verify};
                })));
            }

            const versionedResults: Dict<Dict<VerifyResult>> = Object.assign({}, ...await Promise.all(versions
                .map(async version => {
                    const verify = await verifyBinaries(binaries, version);
                    return {[version]: verify};
                })));


            binaries.sort((a, b) => {
                const importantDiff = Number(b.important) - Number(a.important);
                if (importantDiff != 0) return importantDiff;
                if (a.type == 'main') return -1;
                if (b.type == 'main') return 1;
                return a.name.localeCompare(b.name);
            });
            printTable(binaries, libsInfo, versionedResults, ipkinfo, args.markdown);
        }
    }
}

const argparser = new ArgumentParser();
argparser.add_argument('packages', {type: String, nargs: '+'});
argparser.add_argument('--list', '-l', {action: 'store_const', const: true, default: false});
argparser.add_argument('--markdown', '-m', {action: 'store_const', const: true, default: false});

argparser.add_argument('--verbose', '-v', {action: 'store_const', const: true, default: false});

const args: Args = argparser.parse_args();
mkdtemp(path.resolve(os.tmpdir(), 'webosbrew-compat-checker-')).then(async (tmp: string) => {
    await main(tmp, args).finally(() => rm(tmp, {recursive: true}));
});
