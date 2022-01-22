#!/usr/bin/env node
import {ArgumentParser} from "argparse";

import {verifyElf} from "./utils";

import path from "path";
import {mkdtemp, readdir, readFile, rm, writeFile} from "fs/promises";
import ar from "ar";
import tar, {ReadEntry} from "tar";
import os from "os";
import Table from "cli-table";
import colors from "colors";
import {existsSync} from "fs";

const versions = require(path.join(__dirname, '../data/versions.json'));

interface Args {
    ipk: string;
    list: boolean;
}

async function main(tmp: string, args: Args) {
    const archive = new ar.Archive(await readFile(args.ipk));

    const appdirs: string[] = [];

    function processAppInfoEntry(entry: ReadEntry) {
        if (path.posix.basename(entry.path) === 'appinfo.json') {
            appdirs.push(path.posix.dirname(path.posix.resolve(tmp, entry.path)));
        }
    }

    for (let file of archive.getFiles()) {
        if (file.name() !== 'data.tar.gz') continue;
        const dataPath = path.join(tmp, 'data.tar.gz');
        await writeFile(dataPath, file.fileData());

        // @ts-ignore
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
        const table = new Table({head: ['', ...versions.map((version: string) => version.reset)]});

        const libdir = path.join(appdir, 'lib');

        async function verifyColumn(elf: string) {
            return await Promise.all(versions.map(async (version: string) => {
                const result = await verifyElf(elf, [libdir], version)
                switch (result.status) {
                    case 'ok':
                        return colors.green(result.status);
                    case 'warn':
                        return colors.yellow(result.status);
                    case 'fail':
                        return colors.bold.red(result.status);
                    default:
                        return result;
                }
            }));
        }

        table.push({
            [`main: ${appinfo.main}`.reset]: await verifyColumn(mainexe)
        });

        if (existsSync(libdir)) {
            for (const lib of await readdir(libdir)) {
                table.push({
                    [`lib: ${path.basename(lib)}`.reset]: await verifyColumn(path.join(libdir, lib))
                });
            }
        }
        console.log(table.toString());
    }
}

const argparser = new ArgumentParser();
argparser.add_argument('ipk', {type: String});
argparser.add_argument('--list', '-l', {action: 'store_const', const: true, default: false});

const args: Args = argparser.parse_args();
mkdtemp(path.resolve(os.tmpdir(), 'webosbrew-compat-checker-')).then(async (tmp: string) => {
    await main(tmp, args).finally(() => rm(tmp, {recursive: true}));
});
