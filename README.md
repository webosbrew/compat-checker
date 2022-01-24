# webOS Compatibility Checker

A simple static analyzer for webOS application

## Introduction

Library shipped across webOS versions can be very different. Taking following libraries as example:

|        | 1.4.0  | 2.2.3  | 3.8.0  | 4.9.0  | 5.2.0  | 6.2.0  |
|--------|--------|--------|--------|--------|--------|--------|
| SDL2   | 2.0.0  | 2.0.0  | 2.0.4  | 2.0.5  | 2.0.10 | 2.0.10 |
| crypto | 1.0.1h | 1.0.1h | 1.0.2k | 1.0.2p | 1.0.2p | 1.1.1d |

For native application, this may cause many issues as the program won't work if it linked to library that doesn't exist,
or used an unsupported function.

This tool can help developers quickly find linkage problem, and better understand the compatibility of their app.

## Usage

```
webosbrew-ipk-compat-checker [-h] [--markdown] [--summary] [--verbose | --quiet] packages [packages ...]

positional arguments:
  packages        List of IPKs

optional arguments:
  -h, --help      show this help message and exit
  --markdown, -m  Print validation result in Markdown format, useful for automation
  --summary, -s   Display summary of issues
  --verbose, -v   Print more logs
  --quiet, -q     Do not print anything except result
```

### Example Output

**Compatibility info for com.limelight.webos:**

**Application com.limelight.webos (v1.4.0):**


|                                    | 1.4.0    | 2.2.3    | 3.8.0    | 4.9.0    | 5.2.0    | 6.2.0    |
|------------------------------------|----------|----------|----------|----------|----------|----------|
| **main\*: moonlight**              | ok       | ok       | ok       | ok       | ok       | ok       |
| **lib\*: libmbedcrypto.so.2.27.0** | ok       | ok       | ok       | ok       | ok       | ok       |
| **lib\*: libmbedx509.so.2.27.0**   | ok       | ok       | ok       | ok       | ok       | ok       |
| **lib\*: libmicrodns.so**          | ok       | ok       | ok       | ok       | ok       | ok       |
| **lib\*: libopus.so.0.8.0**        | ok       | ok       | ok       | ok       | ok       | ok       |
| lib: libmoonlight-alsa.so          | ok       | ok       | ok       | ok       | ok       | ok       |
| lib: libmoonlight-cgl.so           | **fail** | ok       | ok       | ok       | ok       | **fail** |
| lib: libmoonlight-lgnc.so          | ok       | ok       | ok       | ok       | ok       | **fail** |
| lib: libmoonlight-ndl-webos5.so    | **fail** | **fail** | **fail** | **fail** | ok       | ok       |
| lib: libmoonlight-ndl.so           | **fail** | **fail** | ok       | ok       | **fail** | **fail** |
| lib: libmoonlight-ndlaud.so        | **fail** | **fail** | ok       | ok       | **fail** | **fail** |
| lib: libmoonlight-pulse.so         | ok       | ok       | ok       | ok       | ok       | ok       |
| lib: libmoonlight-smp-webos3.so    | **fail** | **fail** | ok       | **fail** | **fail** | **fail** |
| lib: libmoonlight-smp-webos4.so    | **fail** | **fail** | **fail** | ok       | **fail** | **fail** |
| lib: libmoonlight-smp.so           | **fail** | **fail** | **fail** | **fail** | ok       | ok       |
