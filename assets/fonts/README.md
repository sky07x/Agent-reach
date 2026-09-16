# Bundled fonts

The `.ttf` files here are **not committed** — they are downloaded by
`infra/scripts/fetch-fonts.sh` and gitignored, so no font binaries live in
the repo.

## Why they exist

AWS Lambda's Node runtime has no fonts installed. `sharp` renders our meme
SVGs through librsvg, which asks fontconfig for a font and gets nothing back.
The result is a correctly drawn background with no text on it, and no error
message telling you why.

`fonts.conf` points fontconfig at this directory, and `template.yaml` sets
`FONTCONFIG_PATH` so Lambda picks it up.

Locally you don't need any of this — macOS and most Linux desktops already
have fonts installed and fontconfig finds them on its own.

## Getting them

```bash
./infra/scripts/fetch-fonts.sh
```

`infra/scripts/deploy.sh` runs this for you if the files are missing.

## Licence

DejaVu Sans and DejaVu Sans Mono, from the DejaVu Fonts project. They are
under a permissive Bitstream Vera derived licence that explicitly allows
redistribution, including bundled inside other software. See
https://dejavu-fonts.github.io/License.html
