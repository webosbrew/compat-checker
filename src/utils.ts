import 'zx/globals';

import fs from "fs";
import path from "path";
import {ProcessOutput} from "zx";

$.verbose = false;

const ignoredSymbols = ['__bss_end__', '_bss_end__', '__bss_start', '__bss_start__', '__end__', '_end', '_fini',
    '_init', '_edata'];

export type VerifyStatus = 'ok' | 'fail' | 'warn';

export interface VerifyResult {
    status: VerifyStatus;
    missingLibraries: string[];
    missingReferences: string[];
    indirectReferences: string[];
}

export interface LibInfo {
    names?: string[];
    symbols?: string[];
    needed?: string[];
}

export class BinutilsNotInstalledError extends Error {
    constructor() {
        super("binutils is not installed.");
    }
}

export async function dumpSymbols(path: string): Promise<string[]> {
    const output = await $`nm --dynamic --extern-only --defined-only ${path}`.catch(handleMissingBinutils);
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
    const output = await $`objdump -p "${path}"`.catch(handleMissingBinutils);
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
    return (await $`c++filt ${sym}`.catch(handleMissingBinutils)).stdout.trim();
}

async function handleMissingBinutils(): Promise<ProcessOutput> {
    throw new BinutilsNotInstalledError();
}

export async function verifyElf(file: string, libs: string[], version: string): Promise<VerifyResult> {
    let status: VerifyStatus = 'ok';
    let objdumpResult = (await $`objdump -p "${file}"`.catch(handleMissingBinutils)).stdout
        .split('\n')
        .map(l => l.trim().split(/[ ]+/));
    const libDirs = [...libs];
    libDirs.push(...objdumpResult
        .filter(segs => segs.length === 2 && segs[0] === 'RUNPATH')
        .map(segs => segs[1]));
    libDirs.push(...objdumpResult.filter(segs => segs.length === 2 && segs[0] === 'RPATH')
        .flatMap((segs: string[]) => segs[1].split(':').filter(i => i)));

    const libDep = objdumpResult
        .filter(segs => segs.length === 2 && segs[0] === 'NEEDED')
        .map(segs => segs[1]);

    const symReq = (await $`nm --dynamic --extern-only --undefined-only ${file}`.catch(handleMissingBinutils)).stdout
        .split('\n')
        .map(l => l.trim().split(/[ ]+/))
        .filter(segs => segs.length === 2 && segs[0] === 'U')
        .map(segs => segs[1]);
    const missingLibraries = [];
    const index = require(path.join(__dirname, `../data/${version}/index.json`));
    for (let lib of libDep) {
        if (!hasLib(libDirs, lib) && !index[lib]) {
            missingLibraries.push(lib);
        }
    }
    const symbols = libDep.map(lib => index[lib]).filter(f => f).flatMap((f: string) => {
        const lib: LibInfo = require(path.join(__dirname, `../data/${version}/${f}`));
        return lib.symbols || [];
    });
    for (const lib of libDep) {
        for (let libDir of libDirs) {
            let libPath = path.join(libDir, lib);
            if (fs.existsSync(libPath)) {
                symbols.push(...(await dumpSymbols(libPath)));
                break
            }
        }
    }
    const indirectSyms = libDep.map(lib => index[lib]).filter(f => f).flatMap((f: string) => {
        const lib: LibInfo = require(path.join(__dirname, `../data/${version}/${f}`));
        return (lib.needed || []).filter((l: string) => !libDep.includes(l));
    }).flatMap((l: string) => {
        const i = index[l];
        if (!i) return [];
        const lib: LibInfo = require(path.join(__dirname, `../data/${version}/${i}`));
        return lib.symbols || [];
    });


    const missingReferences = [], indirectReferences = [];
    for (let symbol of symReq) {
        let found = symMatches(symbols, symbol);
        let indirect = false;
        if (!found) {
            if (symMatches(indirectSyms, symbol)) {
                found = true;
                indirect = true;
            }
        }
        if (!found) {
            let segs = symbol.split('@');
            segs[0] = await demangle(segs[0]) || segs[0];
            missingReferences.push(segs.join('@'));
            status = 'fail';
        } else if (indirect) {
            let segs = symbol.split('@');
            segs[0] = await demangle(segs[0]) || segs[0];
            indirectReferences.push(segs.join('@'));
            status = 'warn';
        }
    }
    return {status, missingLibraries, missingReferences, indirectReferences};
}
