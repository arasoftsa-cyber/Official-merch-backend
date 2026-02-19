const fs = require('fs');
const path = require('path');

const backendRoot = path.join(__dirname, '..');
const frontendRoot = path.join(backendRoot, '..', 'frontend');

function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function listRouteFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listRouteFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.routes.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

function extractMounts() {
  const appFile = path.join(backendRoot, 'app.js');
  const content = readFile(appFile);
  const mounts = [];
  const regex = /app\.use\(\s*(['"`])([^'"]*\/api[^'"]*)\1/g;
  let match;
  while ((match = regex.exec(content))) {
    mounts.push(match[2]);
  }
  return mounts;
}

function extractRouterEndpoints() {
  const routerDirs = [path.join(backendRoot, 'routes'), path.join(backendRoot, 'src', 'modules')];
  const endpoints = [];
  for (const dir of routerDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = listRouteFiles(dir);
    for (const file of files) {
      const relativePath = path.relative(backendRoot, file);
      const text = readFile(file);
      const methodRegex = /router\.(get|post|put|patch|delete|options)\(\s*(['"`])([^'"]+)\2/g;
      let match;
      while ((match = methodRegex.exec(text))) {
        endpoints.push({
          file: relativePath,
          method: match[1].toUpperCase(),
          path: match[3],
        });
      }
    }
  }
  return endpoints;
}

function extractFrontendRoutes() {
  const routes = [];
  const appFile = path.join(frontendRoot, 'src', 'app', 'App.tsx');
  if (!fs.existsSync(appFile)) {
    return routes;
  }
  const text = readFile(appFile);
  const regex = /<Route[^>]*path\s*=\s*(['"`])([^'"]+)\1/g;
  let match;
  while ((match = regex.exec(text))) {
    routes.push(match[2]);
  }
  return routes;
}

function normalizeFrontendPath(route) {
  if (route === '/*') return '/';
  return route.startsWith('/') ? route : `/${route}`;
}

function matchesFrontend(route, mount) {
  const normRoute = normalizeFrontendPath(route);
  const routePrefix = normRoute.split('/').slice(0, 2).join('/');
  if (routePrefix === '/') {
    return mount === '/api';
  }
  const candidate = routePrefix.replace(/^\/+/, '');
  return mount.includes(`/api${routePrefix}`) || mount.includes(`/api/${candidate}`);
}

function matchesBackend(mount, route) {
  const normRoute = normalizeFrontendPath(route);
  return mount.includes(`/api${normRoute}`) || mount === '/api';
}

function buildDiff(mounts, routes) {
  const backendWithoutFrontend = mounts.filter(
    (mount) => !routes.some((route) => matchesFrontend(route, mount))
  );
  const frontendWithoutBackend = routes.filter(
    (route) => !mounts.some((mount) => matchesBackend(mount, route))
  );
  return {
    backend_without_frontend_prefix_match: backendWithoutFrontend,
    frontend_without_backend_prefix_match: frontendWithoutBackend,
  };
}

function main() {
  const mounts = extractMounts();
  const endpoints = extractRouterEndpoints();
  const routes = extractFrontendRoutes();
  const diff = buildDiff(mounts, routes);
  const summary = {
    backend: {
      mounts,
      endpoints,
    },
    frontend: {
      routes,
    },
    diff,
  };
  process.stdout.write(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  main();
}
