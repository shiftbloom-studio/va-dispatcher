import React from "react";

type LinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  children?: React.ReactNode;
};

export default function Link(props: LinkProps) {
  const { href, children, ...rest } = props;
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

