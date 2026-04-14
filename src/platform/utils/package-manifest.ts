import * as fs from 'fs';

export interface PackageManifest {
  name?: string;
  main?: string;
  [key: string]: unknown;
}

export function readPackageManifest(packageJsonPath: string): PackageManifest | null {
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as PackageManifest;
}

export function assertPackageNameMatchesExportedName(
  packageManifest: PackageManifest | null,
  exportedName: string,
  moduleLabel: string
): void {
  const packageName = packageManifest?.name;

  if (packageName && packageName !== exportedName) {
    throw new Error(
      `${moduleLabel} name mismatch: package.json name is "${packageName}" but plugin.name is "${exportedName}". They must match.`
    );
  }
}
