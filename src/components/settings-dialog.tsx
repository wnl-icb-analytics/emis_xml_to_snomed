'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useSettings } from '@/contexts/SettingsContext';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { equivalenceFilter, setEquivalenceFilter } = useSettings();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">Settings</DialogTitle>
          <DialogDescription>
            Configure code expansion and mapping options
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-3">
            <h3 className="text-lg font-semibold">ConceptMap Equivalence Filter</h3>
            <p className="text-sm text-muted-foreground">
              When translating EMIS codes to SNOMED CT, each mapping has an equivalence type that describes how well the concepts match. Choose which equivalence levels to accept:
            </p>
            <RadioGroup
              value={equivalenceFilter}
              onValueChange={setEquivalenceFilter}
              className="space-y-2"
            >
              <div className="flex items-start space-x-2">
                <RadioGroupItem value="strict" id="strict" className="mt-0.5" />
                <div className="space-y-0.5">
                  <Label htmlFor="strict" className="font-medium cursor-pointer">
                    Equivalent + Narrower (Recommended)
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    SNOMED code has the same meaning or is more specific. Safest option - preserves or adds clinical detail.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-2">
                <RadioGroupItem value="with-broader" id="with-broader" className="mt-0.5" />
                <div className="space-y-0.5">
                  <Label htmlFor="with-broader" className="font-medium cursor-pointer">
                    + Broader
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    SNOMED code is less specific than EMIS code. Example: EMIS "Type 2 diabetes with retinopathy" maps to SNOMED "Type 2 diabetes". Increases coverage but loses detail.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-2">
                <RadioGroupItem value="with-related" id="with-related" className="mt-0.5" />
                <div className="space-y-0.5">
                  <Label htmlFor="with-related" className="font-medium cursor-pointer">
                    + Related-to
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    SNOMED code is related but with different context. Example: EMIS "Influenza vaccination given by care home staff" maps to SNOMED "Influenza vaccination". Improves match rate, particularly for EMIS Local codes.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-2">
                <RadioGroupItem value="all" id="all" className="mt-0.5" />
                <div className="space-y-0.5">
                  <Label htmlFor="all" className="font-medium cursor-pointer">
                    + Inexact (All)
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    SNOMED code is the best available match but not a good one. Maximum coverage, lowest confidence. Use with caution.
                  </p>
                </div>
              </div>
            </RadioGroup>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
