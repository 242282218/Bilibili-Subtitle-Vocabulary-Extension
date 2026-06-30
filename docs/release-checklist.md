# Release Checklist

Use this checklist before publishing a new version of Bilibili Subtitle Vocabulary.

1. Update the version in both:
   - `bilibili-vocab-extension/manifest.json`
   - `bilibili-vocab-extension/package.json`
2. Update `CHANGELOG.md` with a new section for the version (follow [Semantic Versioning](https://semver.org/lang/zh-CN/)).
3. Run local quality gates from `bilibili-vocab-extension`:
   - `pnpm run lint`
   - `pnpm run typecheck`
   - `pnpm run test`
   - `pnpm run test:ui`
4. Run `pnpm run build:extension` and confirm the overlay size baseline passes (`pnpm run check:overlay-size`).
5. Run `pnpm run pack` to produce the extension zip.
6. Update store screenshots and descriptions if the UI changed in this release.
7. Create a git tag `vX.Y.Z` and push it.
8. Create a GitHub Release, attach the zip produced in step 5, and paste the changelog notes.
