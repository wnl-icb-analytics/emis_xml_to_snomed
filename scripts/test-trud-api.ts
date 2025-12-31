import { getLatestRF2Release } from '../src/lib/trud-client';

async function main() {
  console.log('Testing TRUD API access...\n');

  const latestRelease = await getLatestRF2Release();

  if (latestRelease) {
    console.log('✓ Successfully retrieved latest RF2 release from TRUD:\n');
    console.log(`Release ID: ${latestRelease.id}`);
    console.log(`Name: ${latestRelease.name}`);
    console.log(`Release Date: ${latestRelease.releaseDate}`);
    console.log(`Archive Filename: ${latestRelease.archiveFileName}`);
    console.log(`Download URL: ${latestRelease.archiveFileUrl}`);
  } else {
    console.error('✗ Failed to retrieve latest RF2 release from TRUD');
    console.error('Check that TRUD_API_KEY is set correctly in .env');
  }
}

main().catch(console.error);
