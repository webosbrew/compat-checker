#!/usr/bin/env node
import {ArgumentParser} from "argparse";

import {binInfo, verifyElf} from "./utils";

import path from "path";
import {WebOSVersions} from "./webos-versions";
import {Printer} from "./printer";

interface Args extends WebOSVersions.Options, Printer.Options {
    libdirs: string[];
    executables?: string[];
    files?: string[];
}

async function main(args: Args) {
    let versions = WebOSVersions.list(args);
    const printer = new Printer(process.stdout, args);
    for (const version of versions) {
        console.log(`On webOS ${version}`);
        console.log('--------');
        const executables: string[] = args.executables ?? args.files ?? [];
        for (let file of executables) {
            console.log(`File ${path.basename(file)}:`);
            const info = await binInfo(file, 'main');
            const result = await verifyElf(info, args.libdirs, version);
            for (const lib of result.missingLibraries) {
                console.error(printer.chalk.red(`Missing library: ${lib}`));
            }
            for (const ref of result.missingReferences) {
                console.error(printer.chalk.red(`Missing symbol: ${ref}`));
            }
            for (const ref of result.noVersionReferences) {
                console.warn(printer.chalk.yellow(`No version info: ${ref}`));
            }
            for (const ref of result.indirectReferences) {
                console.warn(printer.chalk.yellow(`Indirectly referencing: ${ref}`));
            }
            console.log();
        }
        console.log('=======================');
    }
}

const argparser = new ArgumentParser();
argparser.add_argument('-l', '--libdirs', {
    type: String,
    nargs: '+',
    required: false,
    default: [],
    help: 'Extra library paths',
});
const group = argparser.add_mutually_exclusive_group({required: true});
group.add_argument('-e', '--executables', {
    type: String,
    nargs: '+',
    required: false,
    help: 'ELF binaries to verify',
});
group.add_argument('files', {
    type: String,
    nargs: '*',
    default: [],
    help: 'ELF binaries to verify',
});
WebOSVersions.setupArgParser(argparser);
Printer.setupArgParser(argparser);

main(argparser.parse_args()).catch(error => {
    if (error instanceof Error) {
        console.error(error.message);
    } else {
        console.error(error);
    }
    process.exit(1);
});
