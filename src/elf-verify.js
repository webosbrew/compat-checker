#!/usr/bin/env node

const {ArgumentParser} = require('argparse');
const {verifyElf} = require('./utils');
const path = require("path");
const versions = require(path.join(__dirname, '../data/versions.json'));

const argparser = new ArgumentParser();
argparser.add_argument('--libs', '-l', {type: String, nargs: '+', required: false, default: []});
argparser.add_argument('files', {type: String, nargs: '+'});

const args = argparser.parse_args();

for (let file of args.files) {
    for (const version of versions) {
        console.log(`On webOS ${version}`);
        verifyElf(file, args.libs, version);
        console.log('=======================');
    }
}
