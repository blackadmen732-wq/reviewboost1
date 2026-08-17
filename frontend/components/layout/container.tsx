import type { ComponentPropsWithoutRef, ElementType } from "react";
import { cn } from "@/lib/utils/cn";

type ContainerProps<T extends ElementType = "div"> = {
  as?: T;
  size?: "customer" | "app" | "marketing";
} & Omit<ComponentPropsWithoutRef<T>, "as">;
export function Container<T extends ElementType = "div">({
  as,
  size = "app",
  className,
  ...props
}: ContainerProps<T>) {
  const Component = as ?? "div";
  return (
    <Component
      className={cn(
        "mx-auto w-full px-5 sm:px-8 lg:px-12",
        size === "customer" && "max-w-[500px]",
        size === "app" && "max-w-[1216px]",
        size === "marketing" && "max-w-[1296px]",
        className,
      )}
      {...props}
    />
  );
}
