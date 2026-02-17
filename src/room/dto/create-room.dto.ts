import { IsNotEmpty, IsString, IsIn, MaxLength } from 'class-validator';

export class CreateRoomDto {
    @IsNotEmpty()
    @IsString()
    @MaxLength(50)
    name: string;

    @IsNotEmpty()
    @IsIn(['private', 'group'])
    type: 'private' | 'group';
}
