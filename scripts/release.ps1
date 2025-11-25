param(
  [string]$VersionType = "patch",
  [string]$Notes = ""
)
$ErrorActionPreference = "Stop"
npm run build
npm run electron:build
npm version $VersionType -m "chore: release %s"
$version = node -e "console.log(require('./package.json').version)"
$tag = "v$version"
git push
git push --tags
if ($Notes -eq "") {
  $Notes = git log -n 20 --pretty=format:"* %s" | Out-String
}
if (Get-Command gh -ErrorAction SilentlyContinue) {
  gh release create $tag -t $tag -n $Notes
} else {
  Write-Output "gh not installed; created tag $tag and pushed."
}