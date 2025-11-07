# GitHub Workflows

This project uses GitHub Actions workflows for automated building and releasing.

## Build Workflow (`.github/workflows/build.yml`)

**Triggers:** Pull requests to `main` branch

**Purpose:** Validates that the code builds successfully before merging.

**Steps:**
1. Checkout code
2. Setup Node.js 18
3. Install dependencies
4. Run build

This workflow ensures that all pull requests can be built successfully before they are merged.

## Release Workflow (`.github/workflows/release.yml`)

**Triggers:** Push to `main` branch (typically after PR merge)

**Purpose:** Automatically creates versioned releases when PRs are merged to main.

**Steps:**
1. Detect merged PR
2. Read PR labels to determine version bump type
3. Install dependencies and build
4. Bump version in `package.json`
5. Create git tag
6. Push changes and tag
7. Create GitHub release with auto-generated notes

### Version Bump Labels

The workflow determines the version bump type based on PR labels:

- **No label** or **`patch`** label → Patch version bump (0.0.X)
- **`minor`** label → Minor version bump (0.X.0)
- **`major`** label → Major version bump (X.0.0)

### Usage

1. Create a pull request with your changes
2. Add a label to indicate the version bump type:
   - Add `minor` label for new features
   - Add `major` label for breaking changes
   - No label needed for patches/bug fixes (default)
3. Merge the pull request
4. The workflow will automatically:
   - Bump the version in `package.json`
   - Create a git tag
   - Create a GitHub release with auto-generated release notes

### Example

If the current version is `0.2.0`:

- PR with no label → Creates release `v0.2.1`
- PR with `minor` label → Creates release `v0.3.0`
- PR with `major` label → Creates release `v1.0.0`

### Skipping Releases

The workflow will automatically skip release creation if:
- The push was not from a merged PR
- No merged PR could be found for the commit

This prevents accidental releases from direct pushes to main.
