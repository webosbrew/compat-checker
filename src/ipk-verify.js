#!/usr/bin/env node

const {ArgumentParser} = require('argparse');
const {verifyElf} = require('./utils');
const path = require("path");
const fs = require("fs");
const ar = require('ar');
const tar = require('tar');
const {execSync} = require('child_process');
const versions = require(path.join(__dirname, '../data/versions.json'));
const os = require("os");

const argparser = new ArgumentParser();
argparser.add_argument('ipk', {type: String});

const args = argparser.parse_args();

let tmp = fs.mkdtempSync(path.resolve(os.tmpdir(), 'webosbrew-compat-checker-'));
const archive = new ar.Archive(fs.readFileSync(args.ipk));

const appdirs = [];

function processAppInfoEntry(entry) {
    if (path.posix.basename(entry.path) === 'appinfo.json') {
        appdirs.push(path.posix.dirname(path.posix.resolve(tmp, entry.path)));
    }
}

for (let file of archive.getFiles()) {
    if (file.name() !== 'data.tar.gz') continue;
    const dataPath = path.join(tmp, 'data.tar.gz');
    fs.writeFileSync(dataPath, file.fileData());

    tar.extract({gzip: true, file: dataPath, cwd: tmp, sync: true, onentry: processAppInfoEntry});
}

for (const appdir of appdirs) {
    const appinfo = require(path.join(appdir, 'appinfo.json'));
    if (appinfo.type !== 'native') {
        console.log(`Skipping non-native app ${appinfo.id}`);
        continue;
    }
    console.log(`Checking app ${appinfo.id}`);
    const mainexe = path.join(appdir, appinfo.main);
    for (const version of versions) {
        console.log(`On webOS ${version}`);
        console.log(`Main executable ${appinfo.main}:`);
        const libdir = path.join(appdir, 'lib');
        verifyElf(mainexe, [libdir], version);
        for (const lib of fs.readdirSync(libdir)) {
            console.log(`Library ${path.basename(lib)}:`);
            verifyElf(path.join(libdir, lib), [libdir], version);
        }
        console.log('=======================');
    }
}

fs.rmSync(tmp, {recursive: true});
