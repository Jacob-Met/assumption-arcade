# Assumption Arcade

Explore how dropping hypotheses can change the conclusion of familiar theorems. Choose a theorem and assumptions, then inspect a candidate counterexample and the numerical checker’s result.

## Run

Requires Node.js 22 or newer. Set `NEBIUS_API_KEY` in your environment for optional model proposals; never put the key in source. Run `npm start`, then open the localhost URL printed by the server. Run `npm test` for the automated checks.

## Nemotron on Nebius Token Factory

The server asks NVIDIA Nemotron on Nebius Token Factory to propose counterexamples when configured. The local numerical checker evaluates the proposals and rejects candidates that do not satisfy the selected conditions. Numerical checks are not formal mathematical proofs.

## License

MIT; see LICENSE.
