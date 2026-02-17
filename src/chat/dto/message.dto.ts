import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SendMessageDto {
    @IsNotEmpty()
    @IsString()
    roomId: string;

    @IsNotEmpty()
    @IsString()
    @MaxLength(2000)
    content: string;
}
