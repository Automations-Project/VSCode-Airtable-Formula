# VS Code Extension Release Setup Guide

## Required Secrets Configuration

To use the improved release workflow, you'll need to set up the following GitHub repository secrets:

### 1. VSCE_PAT (Visual Studio Code Marketplace Personal Access Token)
Required for publishing to the VS Code Marketplace.

**Steps to create VSCE_PAT:**
1. Go to https://dev.azure.com/
2. Sign in with your Microsoft account (create one if needed)
3. Click on your profile icon → Personal access tokens
4. Click "New Token"
5. Configure the token:
   - Name: "VSCode Extension Publishing"
   - Organization: "All accessible organizations"
   - Expiration: Choose appropriate duration (recommended: 1 year)
   - Scopes: Select "Marketplace" → "Manage"
6. Copy the generated token
7. Go to your GitHub repository → Settings → Secrets and variables → Actions
8. Click "New repository secret"
9. Name: VSCE_PAT
10. Value: Paste your copied token

### 2. OVSX_PAT (Open VSX Registry Personal Access Token)
Required for publishing to the Open VSX Registry (alternative marketplace).

**Steps to create OVSX_PAT:**
1. Go to https://open-vsx.org/
2. Sign in with your GitHub account
3. Go to https://open-vsx.org/user-settings/tokens
4. Click "Create a new Access Token"
5. Enter description: "VSCode Extension Publishing"
6. Click "Create"
7. Copy the generated token
8. Go to your GitHub repository → Settings → Secrets and variables → Actions
9. Click "New repository secret"
10. Name: OVSX_PAT
11. Value: Paste your copied token

## Package.json Requirements

Your package.json should include:

```json
{
  "publisher": "your-publisher-name",
  "scripts": {
    "package": "vsce package",
    "build": "your-build-command",
    "test": "your-test-command"
  }
}
```

## Workflow Features

The improved workflow includes:
- ✅ Node.js 20 support
- ✅ PNPM caching for faster builds
- ✅ Pre-release support
- ✅ Dual marketplace publishing (VS Code + Open VSX)
- ✅ Manual workflow dispatch
- ✅ Comprehensive testing and validation
- ✅ Automatic GitHub release creation
- ✅ Security permissions configuration
- ✅ Build artifact uploading
- ✅ Error handling and validation

## Usage

1. **Automatic Release**: Create a GitHub release (tag) to trigger the workflow
2. **Manual Release**: Use GitHub Actions → Run workflow with custom parameters
3. **Pre-release**: Create a pre-release on GitHub to publish as pre-release

## Troubleshooting

Common issues and solutions:

1. **Permission denied**: Ensure your PAT has correct scopes
2. **Publisher not found**: Verify publisher name in package.json matches your Azure DevOps publisher
3. **Build failures**: Check that your build/test scripts work locally first
4. **Missing files**: Ensure VSIX is generated correctly in the package step

## Migration from Current Workflow

To migrate from your current workflow:

1. **Replace your current release.yml** with the improved version
2. **Set up the required secrets** (VSCE_PAT and OVSX_PAT)
3. **Update package.json** to include required scripts
4. **Test the workflow** with a manual dispatch first
5. **Create a test release** to verify everything works

## Best Practices

- **Use semantic versioning** for your releases (v1.0.0, v1.1.0, etc.)
- **Test locally** before releasing: `pnpm run build && pnpm run test && pnpm run package`
- **Set up branch protection** to prevent direct pushes to main
- **Use pre-releases** for beta testing before stable releases
- **Monitor the workflow runs** in the Actions tab for any issues