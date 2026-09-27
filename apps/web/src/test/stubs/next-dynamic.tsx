import React from "react";

type DynamicOptions = {
  loading?: React.ComponentType<any>;
  ssr?: boolean;
};

// Very small dynamic() stub for unit tests
export default function dynamic<T extends React.ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
  options?: DynamicOptions
): React.ComponentType<React.ComponentProps<T>> {
  const Loading = options?.loading;
  let Loaded: React.ComponentType<any> | null = null;

  function DynamicComponent(props: React.ComponentProps<T>) {
    const [Comp, setComp] = React.useState<React.ComponentType<any> | null>(
      Loaded,
    );

    React.useEffect(() => {
      let cancelled = false;
      if (!Comp) {
        importer().then((mod) => {
          if (cancelled) return;
          const maybe = (mod as any)?.default ?? (mod as any);
          if (typeof maybe === "function") {
            Loaded = maybe as React.ComponentType<any>;
          } else if (
            maybe &&
            typeof maybe === "object" &&
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            React.isValidElement(maybe)
          ) {
            Loaded = (() => maybe) as unknown as React.ComponentType<any>;
          } else {
            // Fallback to a no-op component
            Loaded = (() => null) as React.ComponentType<any>;
          }
          setComp(Loaded);
        });
      }
      return () => {
        cancelled = true;
      };
    }, [Comp]);

    if (!Comp) {
      return Loading ? <Loading /> : null;
    }
    const Component = Comp as React.ComponentType<any>;
    return <Component {...(props as any)} />;
  }

  return DynamicComponent as unknown as React.ComponentType<
    React.ComponentProps<T>
  >;
}

