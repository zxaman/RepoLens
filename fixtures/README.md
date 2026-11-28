# Test fixtures

`scanner/basic/` is a small synthetic repository used by Phase 3 scanner tests. Its files are inert fixture content: RepoLens tests never execute project scripts, install dependencies, or mutate the fixture. `scanner/outside-sentinel.txt` supports a path-boundary test and must not be read through the virtual symlink used in that test.
