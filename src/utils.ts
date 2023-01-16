import 'zx/globals';

import fs from "fs";
import path from "path";
import {ProcessOutput} from "zx";
import Dict = NodeJS.Dict;

$.verbose = false;

const ignoredSymbols = ['__bss_end__', '_bss_end__', '__bss_start', '__bss_start__', '__end__', '_end', '_fini',
    '_init', '_edata'];

export type VerifyStatus = 'ok' | 'fail' | 'warn';

export class VerifyResult {

    constructor(
        public readonly name: string,
        public readonly version: string,
        public readonly requireLibraries: string[],
        public readonly missingLibraries: string[],
        public readonly missingReferences: string[],
        public readonly indirectReferences: string[],
        public readonly noVersionReferences: string[],
    ) {
    }

    get status(): VerifyStatus {
        if (this.missingLibraries.length || this.missingReferences.length) return 'fail';
        if (this.indirectReferences.length) return 'warn';
        if (this.noVersionReferences.length) return 'warn';
        return 'ok';
    }
}

export interface LibInfo {
    names?: string[];
    symbols?: string[];
    needed?: string[];
}

export class CommandNotFoundError extends Error {
    constructor(cmd: string) {
        super(`Command ${cmd} not found.`);
    }
}

export class BinutilsExitCodeError extends Error {
    constructor(output: ProcessOutput) {
        super(`Command exited with status ${output.exitCode}: ${output.stderr}`);
    }
}

export class BinaryInfo {
    constructor(
        public readonly name: string,
        public readonly path: string,
        public readonly type: 'main' | 'lib',
        public readonly rpath: string[],
        public readonly needed: string[],
        public readonly important: boolean,
    ) {
    }
}

export async function dumpSymbols(path: string): Promise<string[]> {
    const output = await $`nm --dynamic --extern-only --defined-only ${path}`.catch(handleBinutilsCommandError);
    if (output.exitCode != 0) throw new Error(output.stderr);
    return output.stdout
        .split('\n')
        .filter(l => l)
        .map(l => l.split(/[ ]+/))
        .filter(segs => segs.length === 3)
        .map(segs => segs[2].replace('@@', '@'))
        .filter(sym => !ignoredSymbols.includes(sym));
}

export async function listNeeded(path: string) {
    const output = await $`objdump -p ${path}`.catch(handleBinutilsCommandError);
    if (output.exitCode != 0) throw new Error(output.stderr);
    return output.stdout
        .split('\n')
        .map(l => l.trim().split(/[ ]+/))
        .filter(segs => segs.length === 2 && segs[0] === 'NEEDED')
        .map(segs => segs[1]);
}

function hasLib(libdirs: string[], lib: string) {
    for (let libdir of libdirs) {
        if (fs.existsSync(path.join(libdir, lib))) {
            return true;
        }
    }
    return false;
}

function symMatches(symbols: string[], symbol: string) {
    if (symbols.includes(symbol)) return true;
    if (!symbol.includes('@')) {
        return symbols.find((s) => s.startsWith(`${symbol}@`));
    }
    return false;
}

async function demangle(sym: string): Promise<string> {
    return (await $`c++filt ${sym}`.catch(handleBinutilsCommandError)).stdout.trim();
}

async function handleBinutilsCommandError(e: ProcessOutput): Promise<ProcessOutput> {
    if (e.exitCode == 127) {
        const matched = e.stderr.match(/([^:\s]+): command not found/);
        if (matched) {
            throw new CommandNotFoundError(matched[1]);
        }
        throw new Error(e.stderr);
    }
    throw new BinutilsExitCodeError(e);
}

async function getSymReq(file: string) {
    return (await $`nm --dynamic --extern-only --undefined-only ${file}`.catch(handleBinutilsCommandError)).stdout
        .split('\n')
        .map(l => l.trim().split(/[ ]+/))
        .filter(segs => segs.length === 2 && segs[0] === 'U')
        .map(segs => segs[1]);
}

export async function binInfo(file: string, type: 'main' | 'lib', mainbin?: BinaryInfo, liblinks?: Dict<string>): Promise<BinaryInfo> {
    let objdumpResult = (await $`objdump -p ${file}`.catch(handleBinutilsCommandError)).stdout
        .split('\n')
        .map(l => l.trim().split(/[ ]+/));
    const rpath = [
        ...objdumpResult.filter(segs => segs.length === 2 && segs[0] === 'RUNPATH').map(segs => segs[1]),
        ...objdumpResult.filter(segs => segs.length === 2 && segs[0] === 'RPATH')
            .flatMap((segs: string[]) => segs[1].split(':').filter(i => i))
            .map(p => p.replace('$ORIGIN', '.'))
    ];
    const needed = objdumpResult.filter(segs => segs.length === 2 && segs[0] === 'NEEDED')
        .map(segs => segs[1]);
    const mainNeeded = mainbin?.needed?.map(name => liblinks?.[name] || name) || [];
    const name = path.basename(file);
    const important = type == 'main' || mainNeeded.includes(name);
    return new BinaryInfo(name, file, type, rpath, needed, important);
}

export async function verifyElf(info: BinaryInfo, libDirs: string[], version: string,
                                mainBin?: BinaryInfo): Promise<VerifyResult> {
    const allLibDirs = [...libDirs, ...info.rpath];

    const requireLibraries = info.needed;

    const symReq = await getSymReq(info.path);
    const missingLibraries = [];
    const index = require(path.join(__dirname, `../data/${version}/index.json`));
    for (let lib of requireLibraries) {
        if (!hasLib(allLibDirs, lib) && !index[lib]) {
            missingLibraries.push(lib);
        }
    }
    const symbols = requireLibraries.map(lib => index[lib]).filter(f => f).flatMap((f: string) => {
        const lib: LibInfo = require(path.join(__dirname, `../data/${version}/${f}`));
        return lib.symbols || [];
    });
    for (const lib of requireLibraries) {
        for (let libDir of allLibDirs) {
            let libPath = path.join(libDir, lib);
            if (fs.existsSync(libPath)) {
                symbols.push(...(await dumpSymbols(libPath)));
                break
            }
        }
    }
    if (info.type == 'lib' && mainBin) {
        symbols.push(...(await dumpSymbols(mainBin.path)));
    }
    const indirectSyms = requireLibraries.map(lib => index[lib]).filter(f => f).flatMap((f: string) => {
        const lib: LibInfo = require(path.join(__dirname, `../data/${version}/${f}`));
        return (lib.needed || []).filter((l: string) => !requireLibraries.includes(l));
    }).flatMap((l: string) => {
        const i = index[l];
        if (!i) return [];
        const lib: LibInfo = require(path.join(__dirname, `../data/${version}/${i}`));
        return lib.symbols || [];
    });

    const missingReferences: string[] = [], indirectReferences: string[] = [], noVersionReferences: string[] = [];
    for (let symbol of symReq) {
        let found = symMatches(symbols, symbol);
        let indirect = false, noVersion = false;
        if (!found) {
            if (symbol.includes('@') && symMatches(symbols, symbol.substring(0, symbol.indexOf('@')))) {
                found = true;
                noVersion = true;
            }
            if (symMatches(indirectSyms, symbol)) {
                found = true;
                indirect = true;
            }
        }
        if (!found) {
            let segs = symbol.split('@');
            segs[0] = await demangle(segs[0]) || segs[0];
            missingReferences.push(segs.join('@'));
        } else if (noVersion) {
            let segs = symbol.split('@');
            segs[0] = await demangle(segs[0]) || segs[0];
            noVersionReferences.push(segs.join('@'));
        } else if (indirect) {
            let segs = symbol.split('@');
            segs[0] = await demangle(segs[0]) || segs[0];
            indirectReferences.push(segs.join('@'));
        }
    }
    return new VerifyResult(path.basename(info.path), version, requireLibraries, missingLibraries, missingReferences,
        indirectReferences, noVersionReferences);
}
