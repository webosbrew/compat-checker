#!/usr/bin/env node
import {ArgumentParser} from "argparse";

import {BinaryInfo, binInfo, verifyElf, VerifyResult} from "./utils";

import path from "path";
import {lstat, mkdtemp, readdir, readlink, rm} from "fs/promises";

import {ArEntry, ArReader} from "ar-async";
import os from "os";
import {existsSync, lstatSync} from "fs";
import tar, {ReadEntry} from 'tar';
import semver from 'semver';
import {AppInfo, ServiceInfo} from "./types";
import {toGenerator} from "./to-generator";
import {Printer} from "./printer";
import colors from "colors";
import Dict = NodeJS.Dict;

const allVersions: string[] = require(path.join(__dirname, '../data/versions.json'));

interface Args extends Printer.Options {
    packages: string[];
    summary: boolean;
    details: boolean;
    verbose: boolean;
    quiet: boolean;
    min_os?: string;
    max_os?: string;
    max_os_exclusive?: string;
    github_emoji: boolean;
}

interface IpkInfo {
    name: string;
    appdirs: string[];
    svcdirs: string[];
    links: Dict<string>;
}

class LibsInfo {
    constructor(
        public readonly libs: BinaryInfo[],
        public readonly links: Dict<string>
    ) {
    }
}

const argparser = new ArgumentParser();
argparser.add_argument('packages', {type: String, nargs: '+', help: 'List of IPKs'});

argparser.add_argument('--min-os', {
    dest: 'min_os'
});

argparser.add_argument('--max-os', {
    dest: 'max_os'
});
argparser.add_argument('--max-os-exclusive', {
    dest: 'max_os_exclusive'
});

argparser.add_argument('--summary', '-s', {
    action: 'store_const',
    const: true,
    default: false,
    help: 'Display summary of issues'
});

argparser.add_argument('--details', '-d', {
    action: 'store_const',
    const: true,
    default: false,
    help: 'Display detailed list of issues'
});

Printer.setupArgParser(argparser);

argparser.add_argument('--github-emoji', '-e', {
    action: 'store_const',
    const: true,
    default: false,
    help: 'Use GitHub Emojis (:ok:) for result output'
});

const verbosity = argparser.add_mutually_exclusive_group();
verbosity.add_argument('--verbose', '-v', {
    action: 'store_const',
    const: true,
    default: false,
    help: 'Print more logs'
});
verbosity.add_argument('--quiet', '-q', {
    action: 'store_const',
    const: true,
    default: false,
    help: 'Do not print anything except result'
});

const args: Args = argparser.parse_args();
const printer = new Printer(process.stdout, args);
mkdtemp(path.resolve(os.tmpdir(), 'webosbrew-compat-checker-')).then(async (tmp: string) => {
    await main(tmp, args).finally(() => rm(tmp, {recursive: true}));
});

async function main(tmp: string, args: Args) {
    const versions = optVersions(args);

    for (const pkg of args.packages) {
        if (!args.quiet) {
            console.log(`Extracting package ${path.basename(pkg)}...`);
        }

        const ipkinfo: IpkInfo = await extractIpk(tmp, pkg);

        printer.h2(`Compatibility info for ${ipkinfo.name}:`);
        for (const appdir of ipkinfo.appdirs) {
            const appinfo = require(path.join(appdir, 'appinfo.json')) as AppInfo;
            printer.h3(`Application ${appinfo.id} (v${appinfo.version}):`);
            if (appinfo.type !== 'native') {
                printer.body(`Application is not native.`);
                printer.hr();
                continue;
            }
            await printVerifyResults(appdir, appinfo.main, ipkinfo, versions);
            printer.hr();
        }
        for (const svcdir of ipkinfo.svcdirs) {
            const svcinfo = require(path.join(svcdir, 'services.json')) as ServiceInfo;
            printer.h3(`Service ${svcinfo.id}:`);
            if (svcinfo.engine !== 'native') {
                printer.body(`Service is not native.`);
                printer.hr();
                continue;
            }
            if (!svcinfo.executable) {
                printer.body(`Service doesn't have valid executable.`);
                printer.hr();
                continue;
            }
            await printVerifyResults(svcdir, svcinfo.executable, ipkinfo, versions);
            printer.hr();
        }
    }
}

async function printVerifyResults(dir: string, exe: string, ipkinfo: IpkInfo, versions: string[]) {
    const libdir = path.join(dir, 'lib');

    const binaries: BinaryInfo[] = [];
    const mainBin = await binInfo(path.join(dir, exe), 'main');
    binaries.push(mainBin);
    const rpathDirs = mainBin.rpath.map(p => path.resolve(dir, p));
    const libdirs = [...rpathDirs, ...[libdir].filter(p => !rpathDirs.includes(p))];

    const allLibs: BinaryInfo[] = [];
    const allLibLinks: Dict<string> = {};

    for (const d of libdirs.reverse()) {
        const i = await listLibraries(d, mainBin);
        allLibs.push(...i.libs);
        Object.assign(allLibLinks, i.links);
        binaries.push(...i.libs);
    }

    const libsInfo = new LibsInfo(allLibs, allLibLinks);

    async function verifyBinaries(binaries: BinaryInfo[], version: string): Promise<Dict<VerifyResult>> {
        return Object.assign({}, ...await Promise.all(binaries.map(async binary => {
            const verify = await verifyElf(binary, libdirs, version, mainBin);
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
    if (args.summary) {
        printSummary(binaries, libsInfo, versions, versionedResults);
    }
    if (args.details) {
        printDetails(binaries, libsInfo, versions, versionedResults);
    }
}

async function extractIpk(tmp: string, pkg: string): Promise<IpkInfo> {
    const appdirs: string[] = [];
    const svcdirs: string[] = [];
    const links: { [key: string]: string } = {};
    let name: string | undefined;
    for await (let {entry, next} of toGenerator<ArReader, ArEntry>(new ArReader(pkg))) {
        if (entry.fileName() !== 'data.tar.gz') {
            next();
            continue;
        }
        await new Promise<void>((resolve, reject) => {
            const unpack = entry.fileData().pipe(tar.x({
                cwd: tmp,
                onentry(entry: ReadEntry) {
                    let filepath = path.posix.resolve(tmp, entry.path);
                    if (path.posix.basename(filepath) === 'appinfo.json') {
                        appdirs.push(path.posix.dirname(filepath));
                    } else if (path.posix.basename(filepath) === 'services.json') {
                        svcdirs.push(path.posix.dirname(filepath));
                    } else if (path.posix.basename(filepath) === 'packageinfo.json') {
                        name = path.posix.basename(path.posix.dirname(filepath));
                    }
                }
            }));
            unpack.once('end', () => resolve());
            unpack.once('error', e => reject(e));
        });
        next();
    }
    if (!name) {
        throw new Error('Unknown package ID');
    }
    return {name, appdirs, svcdirs, links};
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
    const libs = await readdir(libdir).then(files => files.filter(file => file.match(/^.+\.so(.\d+)*$/)));
    const libpaths = libs.map(lib => path.join(libdir, lib));
    const libstats = Object.assign({}, ...libpaths.map(libpath => ({[libpath]: lstatSync(libpath)})));
    const links = Object.assign({}, ...await Promise.all(libpaths.filter(p => libstats[p].isSymbolicLink()).map(async p => ({
        [path.basename(p)]: path.basename(await readlinkr(p))
    }))));
    return new LibsInfo(await Promise.all(libpaths
        .filter(p => !libstats[p].isSymbolicLink())
        .map(async p => await binInfo(p, 'lib', mainbin, links))), links);
}

function optVersions(args: Args): string[] {
    const versions = allVersions.filter(version => {
        if (args.min_os && semver.lt(version, args.min_os)) {
            return false;
        }
        if (args.max_os && semver.gt(version, args.max_os)) {
            return false;
        }
        // noinspection RedundantIfStatementJS
        if (args.max_os_exclusive && semver.gte(version, args.max_os_exclusive)) {
            return false;
        }
        return true;
    });
    if (!versions.length) {
        throw new Error('No version available');
    }
    return versions;
}

function printSummary(binaries: BinaryInfo[], libsInfo: LibsInfo, versions: string[],
                      versionedResults: Dict<Dict<VerifyResult>>) {
    printer.table(versions.map(v => colors.bold(v)), table => {
        const mainbin = binaries.filter(bin => bin.type == 'main')[0]!;
        for (const binary of binaries) {
            let name = `${binary.important ? 'required ' : ''}${binary.type}: ${binary.name}`;
            const needed = mainbin.needed.map(name => libsInfo.links[name] || name);
            const important = binary.type == 'main' || needed.includes(binary.name);
            if (!important) {
                name = name.reset;
            }
            table.push({
                [name]: versions.map(version => {
                    const results = versionedResults[version]!;
                    const status = results[binary.name]!.status;
                    if (important && status === 'fail') {
                        process.exitCode = 1;
                    }
                    if (args.github_emoji) {
                        return `:${status}:`;
                    } else {
                        switch (status) {
                            case 'fail':
                                return status.red;
                            case 'warn':
                                return status.yellow;
                            case 'ok':
                                return status.green;
                        }
                    }
                })
            })
        }
    });
}

function printDetails(binaries: BinaryInfo[], libsInfo: LibsInfo, versions: string[],
                      versionedResults: Dict<Dict<VerifyResult>>) {
    const mainbin = binaries.filter(bin => bin.type == 'main')[0]!;
    for (const version of versions) {
        printer.h4(`On webOS ${version}:`);

        let ok = true;
        for (const binary of binaries) {
            const result = versionedResults[version]![binary.name]!;
            if (result.status === 'ok') {
                continue;
            }

            const needed = mainbin.needed.map(name => libsInfo.links[name] || name);
            const important = binary.type == 'main' || needed.includes(binary.name);
            let name = `${important ? 'required ' : ''}${binary.type}: ${binary.name}`;
            if (important) {
                name = colors.bold(name);
            }
            printer.li(name, 0);

            for (const lib of result.missingLibraries) {
                printer.li(`Missing library: ${lib}`.red, 1);
            }
            for (const ref of result.missingReferences) {
                printer.li(`Missing symbol: ${ref}`.red, 1);
            }
            for (const ref of result.noVersionReferences) {
                printer.li(`No version info: ${ref}`.yellow, 1);
            }
            for (const ref of result.indirectReferences) {
                printer.li(`Indirectly referencing: ${ref}`.yellow, 1);
            }

            ok = false;
        }
        if (ok) {
            printer.body('Didn\'t find any issue');
        }
    }
}
