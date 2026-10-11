# Hopworld submissions

This is where you send your game or character to Hopworld. Once a person has reviewed it, it is published at an address like this:

`https://openspatials.com/hopworld/games/<your GitHub name>/<your game>/`

Hopworld lets players bring their character into your game and take it on to other games. Your game is listed in the Hopworld directory, and players can hop into it from other games. You can submit a character the same way.

What Hopworld is, and how to connect a game: https://openspatials.com/hopworld/
The full guide to submitting: https://openspatials.com/hopworld/submit/

## Before you start

You need:

- a GitHub account. Your GitHub name, in lowercase, becomes part of your address;
- your game connected with the Hopworld skill, with its self-check passing. If it is not connected yet, start with the creator quickstart: https://openspatials.com/hopworld/start/;
- a license file that says how others may use your game.

## The folder layout

Each submission is one folder, under your own GitHub name in lowercase:

```
games/<your GitHub name>/<your game>/
characters/<your GitHub name>/<your character>/
```

A game's folder holds everything the game needs:

```
games/<your GitHub name>/<your game>/
  index.html         your start page
  hop.json           your game's profile, next to index.html
  LICENSE            how others may use your game
  hop/               the connector files the skill added
  ...                the rest of your game: scripts, models, pictures, sounds
```

In `hop.json`, set `url` to the address your game gets: `https://openspatials.com/hopworld/games/<your GitHub name>/<your game>/`. Point the exit portal at `https://openspatials.com/hopworld/directory/` unless you have another game in mind.

A character's folder holds `character.json`, its models and pictures, a `LICENSE`, and, if you want games to use or keep its items, an ownership manifest signed for its address: `https://openspatials.com/hopworld/characters/<your GitHub name>/<your character>/character.json`.

The rules, in short:

- **Names.** Your game's or character's name uses only lowercase letters, numbers and hyphens, up to 40 characters, such as `moss-run`. File names use letters, numbers, `.`, `_` and `-`, with no spaces. A few names belong to the site and cannot be used as an owner name, such as `demo`, `hopworld`, `lib` and `spec`.
- **Static files only.** The site serves your files exactly as they are. It never builds, installs or runs anything. So no server code, no `functions/` folder, no `.env` or other hidden files, and no `node_modules/`. If your game has a build step, send what the build produces.
- **Everything in your folder.** Your game loads its scripts from its own folder, not from other websites. Code from another site could change after your game was reviewed.
- **Size.** Up to 50 MiB and 500 files for a game, and no single file over 25 MiB. A Godot game ships its engine file compressed; the full guide has the four steps.

## The license file

Every submission needs a license file at the top of its folder: `LICENSE`, `LICENSE.md`, `LICENSE.txt` or `COPYING`. It is published beside your work.

Your game or character keeps the license you choose. Hopworld's own licenses do not cover it. If your work uses someone else's art, music, fonts or code, their licenses must allow it, and you credit them in your license file or in a credits file.

## How to submit

1. Fork this repository.
2. Add your folder at `games/<your GitHub name>/<your game>/` (or `characters/...`). Only add or change folders under your own name.
3. Open a pull request.
4. The automatic check runs on the pull request, and its report is attached to it. If a check fails, fix it and push again. The check runs again.
5. A person from Hopworld reviews your submission. They may ask questions in the pull request.
6. When it is approved, a maintainer publishes it. Your game appears at its address and in the directory when the site is next updated.

On your first pull request, a maintainer may need to start the check for you. That is a GitHub safety setting for new contributors.

## What the automatic check does

For each folder your pull request adds or changes, the check:

1. makes sure your GitHub name and your game's name are allowed, and that the folder is under your own name;
2. looks for static files only: nothing hidden, no server code or server settings;
3. checks the size limits;
4. looks for the license file;
5. for a game: finds `index.html` at the top of the folder; checks that every page says what language it is in and turns off translation prompts, which would take the keyboard away from the game; checks that `hop.json` is next to `index.html`, is valid, and has your game's address as its `url`; checks that scripts load only from your folder;
6. for a game: opens it in a hidden browser, where a test character arrives, walks with the keys, and leaves through the exit portal. This is the same self-check the Hopworld skill runs;
7. for a character: checks `character.json`, that every model and picture it names is in the folder with its exact size, that models are single `.glb` files and pictures are real images, and that the ownership manifest is signed, still valid, and made for the character's Hopworld address.

The check uses the Hopworld tools from this repository's release `v0.2.0`, never code from the pull request.

If the self-check needs special keys to reach the exit portal, add `submission.json` to your folder. Only the check reads it; it is never published:

```json
{ "selfcheck": { "exitKeys": "ArrowRight:1300" } }
```

## Run the check yourself first

The same check runs on your computer. You need Node.js 22 and Google Chrome. Get the Hopworld tools: the release package `hopworld-0.2.0.tar.gz` from this repository's Releases page, or the skill zip at https://openspatials.com/hopworld/skill/. Unpack it, run `npm ci --ignore-scripts` once in its `src/` folder, then:

```sh
node src/submit/check.mjs path/to/games/<your GitHub name>/<your game> --author <your GitHub name>
```

It prints one line per check: `PASS` is fine; `FAIL` must be fixed, with a line that says how; `NOTE` is something a reviewer will look at, and does not stop you. Your AI agent can run it for you.

## A person reviews every submission

Passing the check does not publish your game. A person always reviews it first: the license, the content, what the game does, and a play. Every game on the site shares the openspatials.com address with everything else there, so nothing is published without that review.

## Update or remove your submission

- **Update:** open a new pull request that changes your folder. It goes through the check and a review again. When it is published, your folder is replaced as a whole, so files you deleted are gone from the site too.
- **Remove:** open a pull request that deletes your folder, or open an issue. A maintainer takes it off the site and out of the directory at the next update. Copies that players or other sites already saved cannot be called back.

Hopworld may also take down a submission, for example after a complaint about its content or its license.

## Good to know

- Everything you submit is public, including your GitHub name in the address.
- Games on the site share one web address, so another game could read what your game saves in the browser. Do not store anything private there.
- Your game can fetch characters from other sites, since that is how players arrive. It cannot load code from other sites.

## This repository's own license

The submissions in `games/` and `characters/` keep their own licenses, as above. The rest of this repository is Hopworld's own:

- code, such as the workflow in `.github/workflows/`: MIT No Attribution (`LICENSE`);
- documents, such as this README: CC0 1.0 Universal (`LICENSE-DOCS`).
