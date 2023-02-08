import {ArgumentParser} from "argparse";
import path from "path";
import semver from "semver";

export namespace WebOSVersions {

    export declare interface Options {
        min_os?: string;
        max_os?: string;
        max_os_exclusive?: string;
        os_requirements?: string;
    }

    export function setupArgParser(argparser: ArgumentParser) {
        argparser.add_argument('--min-os', {
            dest: 'min_os'
        });

        argparser.add_argument('--max-os', {
            dest: 'max_os'
        });
        argparser.add_argument('--max-os-exclusive', {
            dest: 'max_os_exclusive'
        });
        argparser.add_argument('--os', {
            dest: 'os_requirements',
            help: 'semver range specification'
        });

    }

    export function list(args: WebOSVersions.Options): string[] {
        const allVersions: string[] = require(path.join(__dirname, '../data/versions.json'));
        const versions = allVersions.filter(version => {
            if (args.os_requirements) {
                return semver.satisfies(version, args.os_requirements);
            }
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
}