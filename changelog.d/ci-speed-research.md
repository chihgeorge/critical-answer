### Changed
- CI runs the browser tests in three parallel parts instead of two, so a pull request's checks finish in about 6 minutes instead of about 10. Every test still runs on every pull request and every push to main.

### Fixed
- The browser test for a returning monster's title no longer times out at random. It walks three rooms and took 25–29 seconds on CI, right under the 30-second limit, so it once ran out of time. It now has 60 seconds, like the other long walkthrough tests. A missing title still fails the test within 5 seconds.
