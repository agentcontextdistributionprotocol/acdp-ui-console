import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary';
  children: ReactNode;
}

export function Button({ variant = 'primary', children, className, ...rest }: ButtonProps) {
  return (
    <button className={`btn btn-${variant}${className ? ` ${className}` : ''}`} {...rest}>
      {children}
    </button>
  );
}
