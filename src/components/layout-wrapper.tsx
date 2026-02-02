'use client';

import { usePathname } from 'next/navigation';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';

export default function LayoutWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isLoginPage = pathname === '/login';

  // If on login page, render without sidebar
  if (isLoginPage) {
    return <>{children}</>;
  }

  return (
    <SidebarProvider style={{ '--sidebar-width': '28rem' } as React.CSSProperties}>
      <AppSidebar />
      <SidebarInset className="flex flex-col w-full overflow-hidden">
        <main className="flex-1 overflow-auto w-full bg-background">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

