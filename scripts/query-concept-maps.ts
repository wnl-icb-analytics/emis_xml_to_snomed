import { getAccessToken } from '../src/lib/oauth-client';

const TERMINOLOGY_SERVER_BASE =
  process.env.TERMINOLOGY_SERVER ||
  'https://ontology.onelondon.online/production1/fhir';

const EMIS_TO_SNOMED_CONCEPT_MAP_ID = '8d2953a3-b70b-4727-8a6a-8b4d912535ad'; // Version 2.1.4
const EMIS_TO_SNOMED_FALLBACK_CONCEPT_MAP_ID = 'b5519813-31eb-4cad-8c77-b8999420e3c9'; // DrugCodeID fallback

async function queryConceptMap(conceptMapId: string, token: string) {
  const url = `${TERMINOLOGY_SERVER_BASE}/ConceptMap/${conceptMapId}`;

  console.log(`\nQuerying: ${url}`);

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/fhir+json; charset=utf-8',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Error ${response.status}:`, errorText);
      return null;
    }

    const data = await response.json();

    return {
      id: data.id,
      url: data.url,
      version: data.version,
      name: data.name,
      title: data.title,
      status: data.status,
      description: data.description,
    };
  } catch (error) {
    console.error('Error querying ConceptMap:', error);
    return null;
  }
}

async function searchConceptMapByUrl(canonicalUrl: string, token: string) {
  const url = `${TERMINOLOGY_SERVER_BASE}/ConceptMap?url=${encodeURIComponent(canonicalUrl)}`;

  console.log(`\nSearching by canonical URL: ${url}`);

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/fhir+json; charset=utf-8',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Error ${response.status}:`, errorText);
      return null;
    }

    const bundle = await response.json();

    if (bundle.entry && bundle.entry.length > 0) {
      console.log(`Found ${bundle.entry.length} ConceptMap(s)`);
      return bundle.entry.map((entry: any) => ({
        id: entry.resource.id,
        url: entry.resource.url,
        version: entry.resource.version,
        name: entry.resource.name,
        title: entry.resource.title,
        status: entry.resource.status,
      }));
    }

    return [];
  } catch (error) {
    console.error('Error searching ConceptMap:', error);
    return null;
  }
}

async function main() {
  console.log('Getting OAuth access token...');
  const token = await getAccessToken();
  console.log('Token acquired ✓');

  console.log('\n=== Query by ID (Current Approach) ===');
  console.log('\n--- Primary ConceptMap ---');
  const primary = await queryConceptMap(EMIS_TO_SNOMED_CONCEPT_MAP_ID, token);
  if (primary) {
    console.log(JSON.stringify(primary, null, 2));
  }

  console.log('\n--- Fallback ConceptMap ---');
  const fallback = await queryConceptMap(EMIS_TO_SNOMED_FALLBACK_CONCEPT_MAP_ID, token);
  if (fallback) {
    console.log(JSON.stringify(fallback, null, 2));
  }

  console.log('\n\n=== Search by Canonical URL (Proposed Approach) ===');
  console.log('\n--- Primary ConceptMap by URL ---');
  const primaryByUrl = await searchConceptMapByUrl('http://LDS.nhs/EMIStoSNOMED/CodeID/cm', token);
  if (primaryByUrl) {
    console.log(JSON.stringify(primaryByUrl, null, 2));
  }

  console.log('\n--- Fallback ConceptMap by URL ---');
  const fallbackByUrl = await searchConceptMapByUrl('http://LDS.nhs/EMIS_to_Snomed/DrugCodeID/cm', token);
  if (fallbackByUrl) {
    console.log(JSON.stringify(fallbackByUrl, null, 2));
  }

  // Test sorting by version
  console.log('\n\n=== Testing _sort Parameter ===');
  const sortedUrl = `${TERMINOLOGY_SERVER_BASE}/ConceptMap?url=${encodeURIComponent('http://LDS.nhs/EMIStoSNOMED/CodeID/cm')}&_sort=-version&_count=1`;
  console.log(`Query: ${sortedUrl}`);

  try {
    const response = await fetch(sortedUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/fhir+json; charset=utf-8',
      },
    });

    if (response.ok) {
      const bundle = await response.json();
      if (bundle.entry && bundle.entry.length > 0) {
        console.log('Latest version (using _sort=-version&_count=1):');
        console.log(JSON.stringify({
          id: bundle.entry[0].resource.id,
          url: bundle.entry[0].resource.url,
          version: bundle.entry[0].resource.version,
          status: bundle.entry[0].resource.status,
        }, null, 2));
      }
    } else {
      console.log('_sort parameter not supported or failed:', response.status);
    }
  } catch (error) {
    console.error('Error testing _sort:', error);
  }
}

main().catch(console.error);
