const {ArgumentParser} = require('argparse');
const fs = require('fs');
const path = require("path");
const {dumpSymbols} = require("./utils");

const argparser = new ArgumentParser();
argparser.add_argument('-i', '--input', {type: String, required: true});
argparser.add_argument('-o', '--output', {type: String, required: true});

const args = argparser.parse_args();
const version = /(\d+\.\d+\.\d+)/.exec(fs.readFileSync(path.posix.join(args.input, 'etc', 'issue'))
    .toString('utf-8'))[0];
if (!version) {
    return;
}
console.log(`Extracting symbols list for webOS ${version}`);

const libpaths = ['lib', 'usr/lib'];
libpaths.push(...fs.readFileSync(path.posix.join(args.input, 'etc', 'ld.so.conf'), {encoding: 'utf-8'})
    .split('\n')
    .filter(l => l)
    .map(l => l.trim().substring(1)));

const libs = {};
const index = {};

function resolveLink(dir, name) {
    let link = path.posix.resolve(dir, fs.readlinkSync(path.posix.join(dir, name)));
    while (fs.lstatSync(link).isSymbolicLink()) {
        link = path.posix.resolve(dir, fs.readlinkSync(link));
    }
    return link;
}

for (let libpath of libpaths) {
    const dir = path.posix.join(args.input, libpath);
    if (!fs.existsSync(dir)) {
        console.warn(`${dir} not found.`);
        continue;
    }
    for (let file of fs.readdirSync(dir, {withFileTypes: true})) {
        let item = null;
        if (!file.name.includes('.so')) continue;
        if (file.isFile()) {
            item = libs[file.name] || {};
            try {
                item.symbols = dumpSymbols(path.posix.join(dir, file.name));
            } catch (e) {
                continue;
            }
            libs[file.name] = item;
            index[file.name] = `${file.name}.json`;
        } else if (file.isSymbolicLink()) {
            let target;
            try {
                target = resolveLink(dir, file.name);
            } catch (e) {
                continue;
            }
            let targetName = path.posix.basename(target);
            item = libs[targetName] || {};
            libs[targetName] = item;
            index[file.name] = `${targetName}.json`;
        } else {
            continue;
        }
        item.names = item.names || [];
        item.names.push(file.name);
    }
}

const outdir = path.join(args.output, version);
if (!fs.existsSync(outdir)) {
    fs.mkdirSync(outdir, {recursive: true});
}
fs.writeFileSync(path.join(outdir, 'index.json'), JSON.stringify(index), {encoding: 'utf-8'});
for (let name in libs) {
    let item = libs[name];
    if (!item.symbols) continue;
    fs.writeFileSync(path.join(outdir, `${name}.json`), JSON.stringify(item), {encoding: 'utf-8'});
}
