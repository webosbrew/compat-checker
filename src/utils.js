const {execSync} = require(`child_process`);
const fs = require("fs");
const path = require("path");

const ignoredSymbols = ['__bss_end__', '_bss_end__', '__bss_start', '__bss_start__', '__end__', '_end', '_fini',
    '_init', '_edata'];

function dumpSymbols(path) {
    return execSync(`nm --dynamic --extern-only --defined-only ${path}`).toString('utf-8')
        .split('\n')
        .filter(l => l)
        .map(l => l.split(/[ ]+/))
        .filter(segs => segs.length === 3)
        .map(segs => segs[2].replace('@@', '@'))
        .filter(sym => !ignoredSymbols.includes(sym));
}

function hasLib(libdirs, lib) {
    for (let libdir of libdirs) {
        if (fs.existsSync(path.join(libdir, lib))) {
            return true;
        }
    }
    return false;
}

function verifyElf(file, libs, version) {
    let objdumpResult = execSync(`objdump -p "${file}"`).toString('utf-8')
        .split('\n')
        .map(l => l.trim().split(/[ ]+/));
    const libDirs = [...libs];
    libDirs.push(...objdumpResult
        .filter(segs => segs.length === 2 && segs[0] === 'RUNPATH')
        .map(segs => segs[1]));
    libDirs.push(...objdumpResult.filter(segs => segs.length === 2 && segs[0] === 'RPATH')
        .flatMap(segs => segs[1].split(':').filter(i => i)));

    const libDep = objdumpResult
        .filter(segs => segs.length === 2 && segs[0] === 'NEEDED')
        .map(segs => segs[1]);

    const symReq = execSync(`nm --dynamic --extern-only --undefined-only ${file}`).toString('utf-8')
        .split('\n')
        .map(l => l.trim().split(/[ ]+/))
        .filter(segs => segs.length === 2 && segs[0] === 'U')
        .map(segs => segs[1]);
    console.log('---');
    console.log('Libraries: ');
    const index = require(path.join(__dirname, `../data/${version}/index.json`));
    for (let lib of libDep) {
        if (!hasLib(libDirs, lib) && !index[lib]) {
            console.error(`Library ${lib} not satisfied`);
        }
    }
    console.log('---');
    console.log('Symbols: ');
    const symbols = libDep.map(lib => index[lib]).filter(f => f).flatMap((f) => {
        const lib = require(path.join(__dirname, `../data/${version}/${f}`));
        return lib.symbols;
    });
    libDep.map(lib => {
        for (let libDir of libDirs) {
            let libPath = path.join(libDir, lib);
            if (fs.existsSync(libPath)) {
                symbols.push(...dumpSymbols(libPath));
                break
            }
        }
    })
    for (let symbol of symReq) {
        let found = symbols.includes(symbol);
        if (!found && !symbol.includes('@')) {
            found = symbols.find((s) => s.startsWith(`${symbol}@`));
        }
        if (!found) {
            let segs = symbol.split('@');
            segs[0] = execSync(`c++filt ${segs[0]}`).toString('utf-8').trim() || segs[0];
            console.error(`Symbol ${segs.join('@')} not satisfied`);
        }
    }
}

module.exports = {dumpSymbols, verifyElf};
