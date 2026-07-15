import { KitchenPhrases } from '@camtom/shared';
import { IconChefHat } from './Icons';

interface EmptyKitchenProps {
  /** 'idle' = no pending tickets (success). 'error' = realtime/fetch is down. */
  variant: 'idle' | 'error';
  /** Configurable copy (config.dashboard.kitchenPhrases); falls back to Spanish defaults. */
  phrases?: Partial<KitchenPhrases>;
  /** How many tickets were served today — appended to the idle subtitle as a little brag. */
  servedToday?: number;
}

const FALLBACK = {
  emptyState: '¡Cocina limpia!',
  emptyStateSub: 'No hay tickets pendientes.',
  errorState: 'Perdimos la cocina',
  errorStateSub: 'Sin conexión en tiempo real — mostrando lo último que vimos. Reintentando…',
};

/**
 * Full-zone scene that replaces the blank board.
 * - idle: clean kitchen, chef whistling — clearly "all caught up", not broken.
 * - error: unmistakably a problem (lost the kitchen) so it never reads as "quiet".
 */
export function EmptyKitchen({ variant, phrases, servedToday }: EmptyKitchenProps) {
  if (variant === 'error') {
    return (
      <div className="kitchen-scene kitchen-scene-error" role="alert">
        <div className="kitchen-stage">
          <span className="kitchen-chef kitchen-chef-panic">
            <IconChefHat size={96} />
          </span>
          <span className="kitchen-spark kitchen-spark-1">!</span>
          <span className="kitchen-spark kitchen-spark-2">?</span>
        </div>
        <h2 className="kitchen-headline">{phrases?.errorState || FALLBACK.errorState}</h2>
        <p className="kitchen-sub">{phrases?.errorStateSub || FALLBACK.errorStateSub}</p>
      </div>
    );
  }

  const sub = phrases?.emptyStateSub || FALLBACK.emptyStateSub;
  const brag =
    typeof servedToday === 'number' && servedToday > 0
      ? ` ${servedToday} servido${servedToday === 1 ? '' : 's'} hoy. Buen laburo.`
      : ' A esperar la próxima orden.';

  return (
    <div className="kitchen-scene kitchen-scene-idle">
      <div className="kitchen-stage">
        <span className="kitchen-chef kitchen-chef-idle">
          <IconChefHat size={96} />
        </span>
        <span className="kitchen-steam kitchen-steam-1" />
        <span className="kitchen-steam kitchen-steam-2" />
        <span className="kitchen-steam kitchen-steam-3" />
      </div>
      <h2 className="kitchen-headline">{phrases?.emptyState || FALLBACK.emptyState}</h2>
      <p className="kitchen-sub">{sub}{brag}</p>
    </div>
  );
}
