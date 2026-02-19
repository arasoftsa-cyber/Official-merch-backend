const mockProvider = {
  name: "mock",
  async createAttempt() {
    return {
      providerAttemptId: null,
      metaJson: null,
    };
  },
  async confirmAttempt() {
    return { ok: true };
  },
};

module.exports = mockProvider;
