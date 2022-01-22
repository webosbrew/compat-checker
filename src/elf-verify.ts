#!/usr/bin/env node
import {ArgumentParser} from "argparse";

import {verifyElf} from "./utils";

import path from "path";
import colors from 'colors';

const versions = require(path.join(__dirname, '../data/versions.json'));

const argparser = new ArgumentParser();
argparser.add_argument('--libs', '-l', {type: String, nargs: '+', required: false, default: []});
argparser.add_argument('files', {type: String, nargs: '+'});

const args = argparser.parse_args();

async function main() {
    for (const version of versions) {
        console.log(`On webOS ${version}`);
        console.log('--------');
        for (let file of args.files) {
            console.log(`File ${path.basename(file)}:`);
            const result = await verifyElf(file, args.libs, version);
            for (const lib of result.missingLibraries) {
                console.error(colors.red(`Missing library: ${lib}`));
            }
            for (const ref of result.missingReferences) {
                console.error(colors.red(`Missing symbol: ${ref}`));
            }
            for (const ref of result.indirectReferences) {
                console.warn(colors.yellow(`Indirectly referencing: ${ref}`));
            }
            console.log();
        }
        console.log('=======================');
    }
}

main();
