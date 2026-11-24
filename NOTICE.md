# Third-party notices

Aevum Starter Kit is MIT licensed (see [LICENSE](LICENSE)). It builds on the open-source projects below.
None of their code is copied into this repository: the Solidity libraries are git submodules that keep
their own LICENSE files, and the JavaScript packages are installed from npm.

## Solidity libraries (`contracts/lib`, git submodules)

| Project | Version | License | Source |
|---|---|---|---|
| forge-std | v1.9.6 | MIT or Apache-2.0 | https://github.com/foundry-rs/forge-std |
| OpenZeppelin Contracts | v5.1.0 | MIT | https://github.com/OpenZeppelin/openzeppelin-contracts |

## JavaScript packages (direct dependencies)

| Package | Version | License | Used in |
|---|---|---|---|
| next | 16.4.5 | MIT | web |
| react, react-dom | 19.2.0 | MIT | web |
| qrcode | 1.5.3 | MIT | web |
| @modelcontextprotocol/sdk | 1.12.0 | MIT | packages/aevumpay-mcp |
| zod | 3.25.76 | MIT | packages/aevumpay-mcp |
| viem | 2.57.12 | MIT | server, examples, packages/aevum |
| tsx | 4.23.15 | MIT | examples (dev) |
| typescript | 5.9.3 | Apache-2.0 | all (dev) |

Their own dependencies carry their own licenses. To list them all, run `pnpm licenses list` in the repo root.
