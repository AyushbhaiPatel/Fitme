// Parse env values once - import from here, not from import.meta.env directly

export const ENV = {
  API_URL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
  IS_DEV: import.meta.env.DEV,
  IS_PROD: import.meta.env.PROD,
};
