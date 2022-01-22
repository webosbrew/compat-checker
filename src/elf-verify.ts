#!/usr/bin/env node
import {ArgumentParser} from "argparse";

import {binInfo, BinutilsNotInstalledError, verifyElf} from "./utils";

import path from "path";
import colors from 'colors';

const versions = require(path.join(__dirname, '../data/versions.json'));

interface Args {
    libs: string[];
    files: [];
}

async function main(args: Args) {
    for (const version of versions) {
        console.log(`On webOS ${version}`);
        console.log('--------');
        for (let file of args.files) {
            console.log(`File ${path.basename(file)}:`);
            const info = await binInfo(file, 'main');
            const result = await verifyElf(info, args.libs, version);
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

const argparser = new ArgumentParser();
argparser.add_argument('--libs', '-l', {type: String, nargs: '+', required: false, default: []});
argparser.add_argument('files', {type: String, nargs: '+'});

main(argparser.parse_args()).catch(error => {
    if (error instanceof BinutilsNotInstalledError) {
        console.error(error.message);
    }
    process.exit(1);
});
