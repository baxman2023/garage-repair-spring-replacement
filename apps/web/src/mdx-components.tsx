import type { MDXComponents } from 'mdx/types';

/** Required by @next/mdx (app router): the shared MDX component map. */
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return { ...components };
}
