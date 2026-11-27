# Run wp-shakedown in Docker

The image has PHP 8.3, Composer, Node 22 and every tool installed, so a run gives the same result on any machine and needs no download. It is published on the GitHub Container Registry with each release.

```bash
docker pull ghcr.io/alexposlushnyak/wp-shakedown
```

## Run the checks

Mount the folder to test, read-only, and run as you would run the command:

```bash
docker run --rm -v "$PWD:/work/theme:ro" ghcr.io/alexposlushnyak/wp-shakedown run /work/theme
```

The reports go to the home folder inside the container, which disappears with it. Keep them in a named volume, which also keeps your projects, presets and history between runs:

```bash
docker run --rm -v wp-shakedown:/root/.wp-shakedown -v "$PWD:/work/theme:ro" ghcr.io/alexposlushnyak/wp-shakedown run /work/theme
```

Or write them to a folder you mount with `--out`:

```bash
docker run --rm -v "$PWD:/work/theme:ro" -v "$PWD/../reports:/reports" ghcr.io/alexposlushnyak/wp-shakedown run /work/theme --out /reports
```

The tool never writes into the folder it tests, so the `:ro` mount does not get in its way.

## Open the web page

The page has to listen on every address inside the container, and the port has to be published to 127.0.0.1 of your machine only, with the same number on both sides:

```bash
docker run --rm -p 127.0.0.1:4517:4517 -v wp-shakedown:/root/.wp-shakedown -v "$HOME/Sites:/work:ro" ghcr.io/alexposlushnyak/wp-shakedown ui /work --port 4517 --bind 0.0.0.0
```

Open the address the command prints. The folder dialog of your system is not there inside a container, so add folders under `/work` with the folder list or the path field.

## Notes

- With Colima on macOS, Docker sees only the folders Colima shares, by default your home folder. A folder elsewhere mounts as empty, and the tool then says it cannot tell what the folder is. Start Colima with `--mount <folder>:w` or test a folder in your home.
- The image runs as root. It reads the mounted folder and writes only to its home folder or to `--out`.
- A theme or plugin with a `wp-shakedown.json` uses its settings in the container too. See [Settings file](../reference/config.md).
