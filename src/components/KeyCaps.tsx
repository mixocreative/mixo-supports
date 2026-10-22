import { Fragment } from 'react';

/** A registry shortcut ("Ctrl+Z") drawn as key caps. */
export function KeyCaps({ shortcut }: { shortcut: string }) {
  return <>{shortcut.split('+').map((key, index) => <Fragment key={key}>{index > 0 && '+'}<kbd>{key}</kbd></Fragment>)}</>;
}
