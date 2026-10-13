import { createServer, Server, Socket } from 'net';
import { NodemailerEmailDeliveryAdapter } from '../nodemailer-email-delivery.adapter';

type ServerMode = 'ACCEPT' | 'DROP_AFTER_DATA';

class ControlledSmtpServer {
  private readonly server: Server;
  private readonly sockets = new Set<Socket>();
  acceptedMessages = 0;
  port = 0;

  constructor(private readonly mode: ServerMode) {
    this.server = createServer((socket) => this.handle(socket));
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        this.server.off('error', reject);
        const address = this.server.address();
        if (!address || typeof address === 'string') throw new Error('SMTP port unavailable');
        this.port = address.port;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private handle(socket: Socket): void {
    this.sockets.add(socket);
    socket.once('close', () => this.sockets.delete(socket));
    socket.write('220 synthetic-smtp ESMTP\r\n');
    let buffer = '';
    let receivingData = false;

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      if (receivingData) {
        const terminator = buffer.indexOf('\r\n.\r\n');
        if (terminator < 0) return;
        this.acceptedMessages += 1;
        buffer = buffer.slice(terminator + 5);
        receivingData = false;
        if (this.mode === 'DROP_AFTER_DATA') {
          socket.destroy();
          return;
        }
        socket.write('250 2.0.0 queued synthetic-message-id\r\n');
      }

      let newline = buffer.indexOf('\r\n');
      while (!receivingData && newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 2);
        const command = line.toUpperCase();
        if (command.startsWith('EHLO') || command.startsWith('HELO')) {
          socket.write('250-synthetic-smtp\r\n250-AUTH PLAIN LOGIN\r\n250 PIPELINING\r\n');
        } else if (command.startsWith('AUTH')) {
          socket.write('235 2.7.0 authentication successful\r\n');
        } else if (command.startsWith('MAIL FROM') || command.startsWith('RCPT TO')) {
          socket.write('250 2.1.0 accepted\r\n');
        } else if (command === 'DATA') {
          receivingData = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (command === 'QUIT') {
          socket.end('221 2.0.0 bye\r\n');
        } else if (command) {
          socket.write('250 2.0.0 ok\r\n');
        }
        newline = buffer.indexOf('\r\n');
      }
    });
  }
}

const command = () => ({
  to: 'recipient@example.test',
  subject: 'Synthetic fiscal delivery',
  text: 'Synthetic content only',
  attachments: [],
});

function adapter(port: number): NodemailerEmailDeliveryAdapter {
  return new NodemailerEmailDeliveryAdapter({
    host: '127.0.0.1',
    port,
    secure: false,
    user: 'synthetic-user',
    password: 'synthetic-password',
    fromAddress: 'billing@example.test',
    fromName: 'Synthetic Billing',
  });
}

describe('NodemailerEmailDeliveryAdapter controlled local SMTP', () => {
  it('records a known SMTP acceptance as delivered', async () => {
    const smtp = new ControlledSmtpServer('ACCEPT');
    await smtp.start();
    try {
      await expect(adapter(smtp.port).sendEmail(command())).resolves.toMatchObject({
        outcome: 'DELIVERED',
      });
      expect(smtp.acceptedMessages).toBe(1);
    } finally {
      await smtp.stop();
    }
  });

  it('treats a lost acknowledgement after DATA acceptance as an unknown outcome', async () => {
    const smtp = new ControlledSmtpServer('DROP_AFTER_DATA');
    await smtp.start();
    try {
      await expect(adapter(smtp.port).sendEmail(command())).resolves.toMatchObject({
        outcome: 'UNKNOWN',
        sanitizedErrorCode: 'SMTP_ACCEPTANCE_UNKNOWN',
      });
      expect(smtp.acceptedMessages).toBe(1);
    } finally {
      await smtp.stop();
    }
  });

  it('keeps a proven pre-session connection refusal retryable', async () => {
    const smtp = new ControlledSmtpServer('ACCEPT');
    await smtp.start();
    const unusedPort = smtp.port;
    await smtp.stop();

    await expect(adapter(unusedPort).sendEmail(command())).resolves.toMatchObject({
      outcome: 'TRANSIENT_FAILURE',
      sanitizedErrorCode: 'SMTP_NETWORK_ESOCKET',
    });
  });
});
