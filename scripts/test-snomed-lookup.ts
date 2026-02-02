/**
 * Quick test script to verify SNOMED CT access via authenticated API
 * Run with: npx tsx scripts/test-snomed-lookup.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// Load .env.local manually
const envPath = path.join(process.cwd(), '.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');
envContent.split('\n').forEach(line => {
  const [key, ...valueParts] = line.split('=');
  if (key && !key.startsWith('#')) {
    process.env[key.trim()] = valueParts.join('=').trim();
  }
});

const TERMINOLOGY_SERVER = process.env.TERMINOLOGY_SERVER || 'https://ontology.onelondon.online/production1/fhir';
const ACCESS_TOKEN_URL = process.env.ACCESS_TOKEN_URL;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

async function getAccessToken(): Promise<string> {
  if (!ACCESS_TOKEN_URL || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('OAuth configuration missing. Check .env file.');
  }

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });

  const response = await fetch(ACCESS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(`OAuth failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function testSnomedLookup(code: string, token: string) {
  console.log(`\nLooking up SNOMED code: ${code}`);
  
  const url = `${TERMINOLOGY_SERVER}/CodeSystem/$lookup`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/fhir+json; charset=utf-8',
      'Content-Type': 'application/fhir+json; charset=utf-8',
    },
    body: JSON.stringify({
      resourceType: 'Parameters',
      parameter: [
        { name: 'system', valueUri: 'http://snomed.info/sct' },
        { name: 'code', valueCode: code },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.log(`  ❌ Failed: ${response.status}`);
    console.log(`  Error: ${error.substring(0, 500)}`);
    return null;
  }

  const data = await response.json();
  const display = data.parameter?.find((p: any) => p.name === 'display')?.valueString;
  console.log(`  ✅ Found: ${display || 'No display name'}`);
  return data;
}

async function testEclExpand(ecl: string, token: string) {
  console.log(`\nExpanding ECL: ${ecl}`);
  
  const encodedEcl = encodeURIComponent(ecl);
  const urlParam = `http://snomed.info/sct?fhir_vs=ecl/${encodedEcl}`;
  const url = `${TERMINOLOGY_SERVER}/ValueSet/$expand?url=${encodeURIComponent(urlParam)}&count=5`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/fhir+json; charset=utf-8',
    },
  });

  if (!response.ok) {
    const error = await response.text();
    console.log(`  ❌ Failed: ${response.status}`);
    console.log(`  Error: ${error.substring(0, 500)}`);
    return null;
  }

  const data = await response.json();
  const total = data.expansion?.total || 0;
  const concepts = data.expansion?.contains || [];
  console.log(`  ✅ Total: ${total} concepts`);
  concepts.slice(0, 5).forEach((c: any) => {
    console.log(`     - ${c.code}: ${c.display}`);
  });
  return data;
}

async function main() {
  console.log('=== SNOMED CT Access Test ===\n');
  console.log(`Server: ${TERMINOLOGY_SERVER}`);
  
  try {
    console.log('\n1. Getting OAuth token...');
    const token = await getAccessToken();
    console.log('   ✅ Token acquired');

    // Test 1: Look up a known clinical code (Diabetes mellitus)
    await testSnomedLookup('73211009', token);

    // Test 2: Look up one of the SCT_PREP codes (Atorvastatin 10mg tablets)
    await testSnomedLookup('91941000033117', token);

    // Test 3: Expand a simple ECL query
    await testEclExpand('<< 73211009', token);

    // Test 4: Expand UK Products for a substance
    await testEclExpand('<< (< 10363601000001109 : 762949000 = << 373444002)', token);

    console.log('\n=== Test Complete ===');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
  }
}

main();
