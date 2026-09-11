import { OAuthManager } from './oauth.js';
import { getServiceConfig, type ServiceName } from '../config.js';

const managers = new Map<ServiceName, OAuthManager>();

export function getOAuthManager(service: ServiceName): OAuthManager {
  let manager = managers.get(service);
  if (!manager) {
    const config = getServiceConfig(service);
    if (!config.oauth.clientId || !config.oauth.clientSecret) {
      const envHint = config.oauth.envHint
        ?? `MF_${service.toUpperCase()}_CLIENT_ID / MF_${service.toUpperCase()}_CLIENT_SECRET`;
      throw new Error(`${envHint} environment variables are required for ${service} service`);
    }
    manager = new OAuthManager(config);
    managers.set(service, manager);
  }
  return manager;
}
