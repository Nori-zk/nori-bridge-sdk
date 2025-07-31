module.exports = (request, options) => {
  return options.defaultResolver(request, {
    ...options,
    packageFilter: (pkg) => {
      if (pkg.name === 'node-fetch') {
        return { ...pkg, main: pkg.main };
      }
      return {
        ...pkg,
        main: pkg.module || pkg.main,
      };
    },
  });
};
