import React from "react";

type DynamicOptions = {
  loading?: React.ComponentType<any>;
  ssr?: boolean;
};

// Very small dynamic() stub for unit tests
export default function dynamic<T extends React.ComponentType<any>>(
  _importer: () => Promise<{ default: T }>,
  options?: DynamicOptions
): React.ComponentType<React.ComponentProps<T>> {
  const Loading = options?.loading;
  const Stub = () => (Loading ? <Loading /> : null);
  return Stub as unknown as React.ComponentType<React.ComponentProps<T>>;
}

