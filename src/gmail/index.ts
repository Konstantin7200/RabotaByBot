import { gmail as _gmail } from '@googleapis/gmail';
import { auth } from '../auth';

export const gmail=_gmail({version:'v1',auth});