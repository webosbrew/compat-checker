import WritableStream = NodeJS.WritableStream;
import {ArgumentParser} from "argparse";
import Table from "cli-table";
import chalk, {Chalk} from "chalk";
import escapeHTML from "escape-html";


export class Printer {
    private readonly markdownChars = {
        'top': '', 'top-mid': '', 'top-left': '', 'top-right': '',
        'mid': '-', 'left-mid': '|', 'mid-mid': '|', 'right-mid': '|',
        'bottom': '', 'bottom-mid': '', 'bottom-left': '', 'bottom-right': '',
        'middle': '|', 'left': '|', 'right': '|'
    };
    private lastElem?: string = undefined;

    public readonly chalk: Chalk;

    constructor(private stream: WritableStream, private options: Printer.Options) {
        this.chalk = new chalk.Instance({level: options.markdown ? 0 : 2});
    }

    body(str: string) {
        this.prependBreak('body');
        this.stream.write(str);
        this.stream.write('\n');
    }

    h1(str: string) {
        this.prependBreak('h1');
        this.stream.write(`# ${str}\n`);
    }

    h2(str: string) {
        this.prependBreak('h2');
        this.stream.write(`## ${str}\n`);
    }

    h3(str: string) {
        this.prependBreak('h3');
        this.stream.write(`### ${str}\n`);
    }

    h4(str: string) {
        this.prependBreak('h4');
        this.stream.write(`#### ${str}\n`);
    }

    hr() {
        this.prependBreak('hr');
        this.stream.write('---\n');
    }

    li(str: string, indent: number = 0) {
        this.prependBreak('li');
        this.stream.write(`${'    '.repeat(indent)} * ${str}\n`);
    }

    table(header: string[], setup: (table: Table) => void) {
        this.prependBreak('table');
        const table = new Table({
            colors: false,
            style: {
                compact: this.options.markdown,
                head: [],
                border: this.options.markdown ? [] : ['grey']
            },
            chars: this.options.markdown ? this.markdownChars : {},
            head: ['', ...header.map(s => this.chalk.bold(s))]
        });
        setup(table);
        this.stream.write(table.toString());
        this.stream.write('\n');
    }

    private prependBreak(e: string) {
        if (e === 'li' && this.lastElem === 'li') {
            return;
        }
        if (this.lastElem) {
            this.stream.write('\n');
        }
        this.lastElem = e;
    }

    beginDetails(summary: string) {
        if (!this.options.markdown) {
            return;
        }
        this.stream.write(`\n<details>\n<summary>${escapeHTML(summary)}</summary>\n`);
    }

    endDetails() {
        if (!this.options.markdown) {
            return;
        }
        this.stream.write('\n</details>\n')
    }
}

export namespace Printer {

    export declare interface Options {

        markdown: boolean;
    }

    export function setupArgParser(argparser: ArgumentParser) {
        argparser.add_argument('--markdown', '-m', {
            action: 'store_const',
            const: true,
            default: false,
            help: 'Print validation result in Markdown format, useful for automation'
        });
    }
}