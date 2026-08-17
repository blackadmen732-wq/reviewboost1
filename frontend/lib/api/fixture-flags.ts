interface FixtureEnvironment {
  nodeEnv: string | undefined;
  fixtureFlag: string | undefined;
}

export function shouldUseCustomerFixtures(
  environment: FixtureEnvironment = {
    nodeEnv: process.env.NODE_ENV,
    fixtureFlag: process.env.NEXT_PUBLIC_USE_CUSTOMER_FIXTURES,
  },
): boolean {
  if (environment.fixtureFlag !== "true") {
    return false;
  }

  if (environment.nodeEnv === "production") {
    throw new Error("Customer fixtures are forbidden in production.");
  }

  return true;
}
