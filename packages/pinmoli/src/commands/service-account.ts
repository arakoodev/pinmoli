import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ServiceAccountResult {
  success: boolean;
  message: string;
  projectId?: string;
}

export function configureServiceAccount(jsonPath: string, location = 'us-central1'): ServiceAccountResult {
  const resolved = resolve(jsonPath);

  if (!existsSync(resolved)) {
    return { success: false, message: `File not found: ${resolved}` };
  }

  let json: any;
  try {
    json = JSON.parse(readFileSync(resolved, 'utf-8'));
  } catch {
    return { success: false, message: `Failed to parse JSON: ${resolved}` };
  }

  if (!json.project_id) {
    return { success: false, message: 'Service account JSON missing project_id field' };
  }

  process.env.GOOGLE_APPLICATION_CREDENTIALS = resolved;
  process.env.GOOGLE_CLOUD_PROJECT = json.project_id;
  process.env.GOOGLE_CLOUD_LOCATION = location;

  return {
    success: true,
    message: `Configured Vertex AI: project=${json.project_id}, location=${location}`,
    projectId: json.project_id
  };
}

export function isVertexConfigured(): boolean {
  return !!(
    process.env.GOOGLE_APPLICATION_CREDENTIALS &&
    process.env.GOOGLE_CLOUD_PROJECT &&
    process.env.GOOGLE_CLOUD_LOCATION
  );
}
