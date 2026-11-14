'use client';

import { useAppMode } from '@/contexts/AppModeContext';
import ExploreMode from '@/components/explore-mode';
import BatchExtractor from '@/components/batch-extractor';
import CompareMode from '@/components/compare-mode';
import { useIsMobile } from '@/hooks/use-mobile';
import { Card } from '@/components/ui/card';
import { AlertCircle } from 'lucide-react';

export default function HomePage() {
  const { mode } = useAppMode();
  const isMobile = useIsMobile();

  // Show mobile incompatibility message when on mobile
  if (isMobile) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <Card className="max-w-md w-full p-6">
          <div className="flex items-start gap-4">
            <AlertCircle className="h-6 w-6 text-orange-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h2 className="text-lg font-semibold mb-2">Mobile Not Supported</h2>
              <p className="text-sm text-muted-foreground">
                This application is not compatible with mobile screen resolutions. Please access this site from a desktop or tablet device with a wider screen.
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  // Render the appropriate mode component
  if (mode === 'compare') return <CompareMode />;
  return mode === 'extract' ? <BatchExtractor /> : <ExploreMode />;
}
